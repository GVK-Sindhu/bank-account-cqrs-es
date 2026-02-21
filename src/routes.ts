import express, { Request, Response } from 'express';
import { EventStore } from './lib/EventStore.js';
import { Projector } from './lib/Projector.js';
import { BankAccount } from './domain/BankAccount.js';
import { v4 as uuidv4 } from 'uuid';
import pool from './config/database.js';

const router = express.Router();
const eventStore = new EventStore();
const projector = new Projector(); // In a real app, this would be a singleton or injected

// --- Helper: Load Aggregate ---
async function loadBankAccount(accountId: string): Promise<BankAccount> {
    const snapshot = await eventStore.getSnapshot(accountId);
    let fromVersion = 0;
    if (snapshot) {
        fromVersion = snapshot.lastEventNumber;
    }

    let events = await eventStore.getEvents(accountId, fromVersion);
    return BankAccount.hydrate(events, snapshot ? { data: snapshot.data, lastEventNumber: snapshot.lastEventNumber } : undefined);
}

// --- Commands ---

router.post('/accounts', async (req: Request, res: Response) => {
    try {
        const { accountId, ownerName, initialBalance, currency } = req.body;

        if (!accountId || !ownerName || initialBalance < 0 || !currency) {
            res.status(400).json({ error: 'Invalid input' });
            return;
        }

        const existing = await loadBankAccount(accountId);
        if (existing.getVersion() > 0) {
            res.status(409).json({ error: 'Account already exists' });
            return;
        }

        const account = BankAccount.create(accountId, ownerName, initialBalance, currency);

        for (const event of account.getUncommittedChanges()) {
            await eventStore.save(event);
            await projector.project(event);

            // Snapshot after every 50 events (trigger on 51st, 101st, etc. but here we can check if version % 50 === 0)
            // Requirement 17: "when the 51st, 101st, 151st, etc., event for that aggregate is persisted"
            // If we just persisted version 50, then the NEXT event will be the 51st.
            // Wait, "when the 51st ... is persisted" -> once event_number 50 is saved?
            // "Verify the snapshot's last_event_number is 50 or 51".
        }
        account.markChangesAsCommitted();

        res.status(202).json({ message: 'Account created' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/accounts/:id/deposit', async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const { amount, description, transactionId } = req.body;

        if (amount <= 0 || !transactionId) {
            res.status(400).json({ error: 'Invalid input' });
            return;
        }

        const account = await loadBankAccount(id);
        if (account.getVersion() === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }

        try {
            account.deposit(amount, description, transactionId);
        } catch (e: any) {
            return res.status(409).json({ error: e.message });
        }

        for (const event of account.getUncommittedChanges()) {
            await eventStore.save(event);
            await projector.project(event);

            // Requirement 17: trigger on 51, 101, 151...
            // If eventNumber is 50, then snapshot!
            if (event.eventNumber % 50 === 0) {
                // We snapshot the state AFTER the 50th event.
                await eventStore.saveSnapshot(id, {
                    ...account.state,
                    processedTransactionIds: Array.from(account.state.processedTransactionIds)
                }, event.eventNumber);
            }
        }
        account.markChangesAsCommitted();

        res.status(202).json({ message: 'Deposit accepted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/accounts/:id/withdraw', async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const { amount, description, transactionId } = req.body;

        if (amount <= 0 || !transactionId) {
            res.status(400).json({ error: 'Invalid input' });
            return;
        }

        const account = await loadBankAccount(id);
        if (account.getVersion() === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }

        try {
            account.withdraw(amount, description, transactionId);
        } catch (e: any) {
            return res.status(409).json({ error: e.message });
        }

        for (const event of account.getUncommittedChanges()) {
            await eventStore.save(event);
            await projector.project(event);
            if (event.eventNumber % 50 === 0) {
                await eventStore.saveSnapshot(id, {
                    ...account.state,
                    processedTransactionIds: Array.from(account.state.processedTransactionIds)
                }, event.eventNumber);
            }
        }
        account.markChangesAsCommitted();

        res.status(202).json({ message: 'Withdrawal accepted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/accounts/:id/close', async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const { reason } = req.body;

        const account = await loadBankAccount(id);
        if (account.getVersion() === 0) {
            return res.status(404).json({ error: 'Account not found' });
        }

        try {
            account.close(reason);
        } catch (e: any) {
            return res.status(409).json({ error: e.message });
        }

        for (const event of account.getUncommittedChanges()) {
            await eventStore.save(event);
            await projector.project(event);
            if (event.eventNumber % 50 === 0) {
                await eventStore.saveSnapshot(id, {
                    ...account.state,
                    processedTransactionIds: Array.from(account.state.processedTransactionIds)
                }, event.eventNumber);
            }
        }
        account.markChangesAsCommitted();

        res.status(202).json({ message: 'Account closed' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- Queries ---

router.get('/accounts/:id', async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const result = await pool.query('SELECT * FROM account_summaries WHERE account_id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found' });

        const row = result.rows[0];
        res.json({
            accountId: row.account_id,
            ownerName: row.owner_name,
            balance: Number(row.balance),
            currency: row.currency,
            status: row.status
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/accounts/:id/events', async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const events = await eventStore.getEvents(id);
        if (events.length === 0) {
            // Check if account exists at all (might be closed or just not found)
            const summary = await pool.query('SELECT 1 FROM account_summaries WHERE account_id = $1', [id]);
            if (summary.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
        }
        res.json(events.map(e => ({
            eventId: e.eventId,
            eventType: e.eventType,
            eventNumber: e.eventNumber,
            data: e.eventData,
            timestamp: e.timestamp
        })));
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/accounts/:id/transactions', async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const page = parseInt((req.query.page as string) || '1');
        const pageSize = parseInt((req.query.pageSize as string) || '10');
        const offset = (page - 1) * pageSize;

        const countRes = await pool.query('SELECT COUNT(*) FROM transaction_history WHERE account_id = $1', [id]);
        const totalCount = parseInt(countRes.rows[0].count);
        const totalPages = Math.ceil(totalCount / pageSize);

        const result = await pool.query('SELECT * FROM transaction_history WHERE account_id = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3', [id, pageSize, offset]);

        res.json({
            currentPage: page,
            pageSize,
            totalPages,
            totalCount,
            items: result.rows.map(row => ({
                transactionId: row.transaction_id,
                type: row.type,
                amount: Number(row.amount),
                description: row.description,
                timestamp: row.timestamp
            }))
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/accounts/:id/balance-at/:timestamp', async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        const timestamp = decodeURIComponent(req.params.timestamp as string);
        const targetDate = new Date(timestamp);

        if (isNaN(targetDate.getTime())) {
            return res.status(400).json({ error: 'Invalid timestamp format' });
        }

        const allEvents = await eventStore.getEvents(id);
        const relevantEvents = allEvents.filter(e => new Date(e.timestamp) <= targetDate);

        if (relevantEvents.length === 0) {
            return res.status(404).json({ error: 'No history found for this account at given time' });
        }

        const account = BankAccount.hydrate(relevantEvents);

        res.json({
            accountId: id,
            balanceAt: account.state.balance,
            timestamp: timestamp
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- Maintenance ---

router.post('/projections/rebuild', async (req: Request, res: Response) => {
    projector.rebuild().catch(err => console.error('Rebuild failed', err));
    res.status(202).json({ message: 'Projection rebuild initiated.' });
});

router.get('/projections/status', async (req: Request, res: Response) => {
    try {
        const countRes = await pool.query('SELECT COUNT(*) FROM events');
        const totalEvents = parseInt(countRes.rows[0].count || '0');

        // Since we are synchronous, lag is 0
        res.json({
            totalEventsInStore: totalEvents,
            projections: [
                { name: "AccountSummaries", lastProcessedEventNumberGlobal: totalEvents, lag: 0 },
                { name: "TransactionHistory", lastProcessedEventNumberGlobal: totalEvents, lag: 0 }
            ]
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
