export enum EventType {
  AccountCreated = 'AccountCreated',
  MoneyDeposited = 'MoneyDeposited',
  MoneyWithdrawn = 'MoneyWithdrawn',
  AccountClosed = 'AccountClosed',
}

export interface DomainEvent {
  eventId: string;
  aggregateId: string;
  aggregateType: string;
  eventType: EventType;
  eventData: any;
  eventNumber: number;
  timestamp: Date;
  version: number;
}

export interface AccountCreatedData {
  ownerName: string;
  initialBalance: number;
  currency: string;
}

export interface MoneyDepositedData {
  amount: number;
  description?: string;
  transactionId: string;
}

export interface MoneyWithdrawnData {
  amount: number;
  description?: string;
  transactionId: string;
}

export interface AccountClosedData {
  reason?: string;
}

export interface Snapshot {
  snapshotId: string;
  aggregateId: string;
  snapshotData: any; // Aggregate State
  lastEventNumber: number;
  createdAt: Date;
}

export interface BankAccountState {
  accountId: string;
  ownerName: string;
  balance: number;
  currency: string;
  status: 'OPEN' | 'CLOSED';
  processedTransactionIds: Set<string>; // For idempotency
}
