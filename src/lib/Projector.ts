import pool from '../config/database.js';
import { DomainEvent, EventType, AccountCreatedData, MoneyDepositedData, MoneyWithdrawnData, AccountClosedData } from '../types.js';

export class Projector {
    async project(event: DomainEvent): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Idempotency check: only process if event version > current projection version
            const summaryRes = await client.query('SELECT version FROM account_summaries WHERE account_id = $1', [event.aggregateId]);
            const currentVersion = summaryRes.rows.length > 0 ? parseInt(summaryRes.rows[0].version) : 0;

            if (event.version <= currentVersion && event.eventType !== EventType.AccountCreated) {
                await client.query('ROLLBACK');
                return;
            }

            switch (event.eventType) {
                case EventType.AccountCreated:
                    if (summaryRes.rows.length === 0) {
                        await this.projectAccountCreated(client, event);
                    }
                    break;
                case EventType.MoneyDeposited:
                    await this.projectMoneyDeposited(client, event);
                    break;
                case EventType.MoneyWithdrawn:
                    await this.projectMoneyWithdrawn(client, event);
                    break;
                case EventType.AccountClosed:
                    await this.projectAccountClosed(client, event);
                    break;
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Projection error:', error);
        } finally {
            client.release();
        }
    }

    private async projectAccountCreated(client: any, event: DomainEvent) {
        const data = event.eventData as AccountCreatedData;
        const query = `
      INSERT INTO account_summaries (account_id, owner_name, balance, currency, status, version)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (account_id) DO NOTHING
    `;
        await client.query(query, [
            event.aggregateId,
            data.ownerName,
            data.initialBalance,
            data.currency,
            'OPEN',
            event.version
        ]);
    }

    private async projectMoneyDeposited(client: any, event: DomainEvent) {
        const data = event.eventData as MoneyDepositedData;

        // Update Summary
        const updateSummary = `
      UPDATE account_summaries 
      SET balance = balance + $1, version = $2
      WHERE account_id = $3
    `;
        await client.query(updateSummary, [data.amount, event.version, event.aggregateId]);

        // Add Transaction (idempotent via transaction_id primary key)
        const insertTransaction = `
      INSERT INTO transaction_history (transaction_id, account_id, type, amount, description, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (transaction_id) DO NOTHING
    `;
        await client.query(insertTransaction, [
            data.transactionId,
            event.aggregateId,
            'DEPOSIT',
            data.amount,
            data.description || 'Deposit',
            event.timestamp
        ]);
    }

    private async projectMoneyWithdrawn(client: any, event: DomainEvent) {
        const data = event.eventData as MoneyWithdrawnData;

        // Update Summary
        const updateSummary = `
      UPDATE account_summaries 
      SET balance = balance - $1, version = $2
      WHERE account_id = $3
    `;
        await client.query(updateSummary, [data.amount, event.version, event.aggregateId]);

        // Add Transaction
        const insertTransaction = `
      INSERT INTO transaction_history (transaction_id, account_id, type, amount, description, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (transaction_id) DO NOTHING
    `;
        await client.query(insertTransaction, [
            data.transactionId,
            event.aggregateId,
            'WITHDRAWAL',
            data.amount,
            data.description || 'Withdrawal',
            event.timestamp
        ]);
    }

    private async projectAccountClosed(client: any, event: DomainEvent) {
        const updateSummary = `
      UPDATE account_summaries 
      SET status = 'CLOSED', version = $1
      WHERE account_id = $2
    `;
        await client.query(updateSummary, [event.version, event.aggregateId]);
    }

    async rebuild(): Promise<void> {
        // Truncate tables
        await pool.query('TRUNCATE TABLE account_summaries, transaction_history CASCADE');

        // Replay all events ordered by timestamp (approximate global order)
        // Since event_number is per aggregate, we can't strictly use it for global interleaving
        // But for projection rebuild, as long as each aggregate's events are in order, 
        // the final state is correct.
        const result = await pool.query('SELECT * FROM events ORDER BY timestamp ASC, event_number ASC');
        for (const row of result.rows) {
            const event: DomainEvent = {
                eventId: row.event_id,
                aggregateId: row.aggregate_id,
                aggregateType: row.aggregate_type,
                eventType: row.event_type as EventType,
                eventData: row.event_data,
                eventNumber: row.event_number,
                version: row.version,
                timestamp: row.timestamp
            };
            await this.project(event);
        }
    }
}
