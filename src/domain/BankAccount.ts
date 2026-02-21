import { BankAccountState, DomainEvent, EventType, AccountCreatedData, MoneyDepositedData, MoneyWithdrawnData, AccountClosedData } from '../types.js';
import { v4 as uuidv4 } from 'uuid';

export class BankAccount {
    public state: BankAccountState;
    private changes: DomainEvent[] = [];
    private version: number = 0;

    constructor() {
        this.state = {
            accountId: '',
            ownerName: '',
            balance: 0,
            currency: '',
            status: 'CLOSED',
            processedTransactionIds: new Set(),
        };
    }

    // --- Factory Method ---
    static create(id: string, ownerName: string, initialBalance: number, currency: string): BankAccount {
        const account = new BankAccount();
        const event: DomainEvent = {
            eventId: uuidv4(),
            aggregateId: id,
            aggregateType: 'BankAccount',
            eventType: EventType.AccountCreated,
            eventData: { ownerName, initialBalance, currency },
            eventNumber: 1,
            timestamp: new Date(),
            version: 1
        };
        account.apply(event);
        account.changes.push(event);
        return account;
    }

    // --- Command Handlers ---
    deposit(amount: number, description: string, transactionId: string): void {
        if (this.state.status === 'CLOSED') throw new Error('Account is closed');
        if (amount <= 0) throw new Error('Deposit amount must be positive');
        if (this.state.processedTransactionIds.has(transactionId)) return; // Idempotency check

        const newVersion = this.version + 1;
        const event: DomainEvent = {
            eventId: uuidv4(),
            aggregateId: this.state.accountId,
            aggregateType: 'BankAccount',
            eventType: EventType.MoneyDeposited,
            eventData: { amount, description, transactionId },
            eventNumber: newVersion,
            timestamp: new Date(),
            version: newVersion
        };
        this.apply(event);
        this.changes.push(event);
    }

    withdraw(amount: number, description: string, transactionId: string): void {
        if (this.state.status === 'CLOSED') throw new Error('Account is closed');
        if (amount <= 0) throw new Error('Withdrawal amount must be positive');
        if (this.state.balance < amount) throw new Error('Insufficient funds');
        if (this.state.processedTransactionIds.has(transactionId)) return; // Idempotency check

        const newVersion = this.version + 1;
        const event: DomainEvent = {
            eventId: uuidv4(),
            aggregateId: this.state.accountId,
            aggregateType: 'BankAccount',
            eventType: EventType.MoneyWithdrawn,
            eventData: { amount, description, transactionId },
            eventNumber: newVersion,
            timestamp: new Date(),
            version: newVersion
        };
        this.apply(event);
        this.changes.push(event);
    }

    close(reason: string): void {
        if (this.state.status === 'CLOSED') throw new Error('Account is already closed');
        if (this.state.balance !== 0) throw new Error('Cannot close account with non-zero balance');

        const newVersion = this.version + 1;
        const event: DomainEvent = {
            eventId: uuidv4(),
            aggregateId: this.state.accountId,
            aggregateType: 'BankAccount',
            eventType: EventType.AccountClosed,
            eventData: { reason },
            eventNumber: newVersion,
            timestamp: new Date(),
            version: newVersion
        };
        this.apply(event);
        this.changes.push(event);
    }

    // --- Event Applier ---
    public apply(event: DomainEvent): void {
        switch (event.eventType) {
            case EventType.AccountCreated:
                const createdData = event.eventData as AccountCreatedData;
                this.state.accountId = event.aggregateId;
                this.state.ownerName = createdData.ownerName;
                this.state.balance = Number(createdData.initialBalance);
                this.state.currency = createdData.currency;
                this.state.status = 'OPEN';
                break;
            case EventType.MoneyDeposited:
                const depositedData = event.eventData as MoneyDepositedData;
                this.state.balance += Number(depositedData.amount);
                this.state.processedTransactionIds.add(depositedData.transactionId);
                break;
            case EventType.MoneyWithdrawn:
                const withdrawnData = event.eventData as MoneyWithdrawnData;
                this.state.balance -= Number(withdrawnData.amount);
                this.state.processedTransactionIds.add(withdrawnData.transactionId);
                break;
            case EventType.AccountClosed:
                this.state.status = 'CLOSED';
                break;
        }
        this.version = event.version;
    }

    // --- Hydration ---
    static hydrate(events: DomainEvent[], snapshot?: { data: any, lastEventNumber: number }): BankAccount {
        const account = new BankAccount();

        if (snapshot) {
            account.state = { ...snapshot.data };
            // Restore Set
            if (Array.isArray(snapshot.data.processedTransactionIds)) {
                account.state.processedTransactionIds = new Set(snapshot.data.processedTransactionIds);
            } else if (snapshot.data.processedTransactionIds instanceof Set) {
                // Already a Set (rare in deserialization but possible in-memory)
                account.state.processedTransactionIds = new Set(snapshot.data.processedTransactionIds);
            } else {
                account.state.processedTransactionIds = new Set();
            }
            account.version = snapshot.lastEventNumber;
        }

        for (const event of events) {
            account.apply(event);
        }
        return account;
    }

    public getUncommittedChanges(): DomainEvent[] {
        return this.changes;
    }

    public markChangesAsCommitted(): void {
        this.changes = [];
    }

    public getVersion(): number {
        return this.version;
    }

    public getId(): string {
        return this.state.accountId;
    }
}
