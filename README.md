# Bank Account Management API (ES/CQRS)

A fully functional bank account management API built using **Event Sourcing (ES)** and **Command Query Responsibility Segregation (CQRS)** architectural patterns.

## Features

- **Event Sourcing**: Every state change is stored as an immutable event, providing a perfect audit trail.
- **CQRS**: Separate models for commands (write) and queries (read).
- **Snapshotting**: Automatic state snapshots after every 50 events to optimize aggregate recovery.
- **Time-Travel**: Reconstruct account balance at any point in history.
- **Projection Rebuild**: Administrative capability to rebuild read models from the ground up.
- **Idempotency**: Handled using transaction IDs and aggregate versions.
- **Dockerized**: Fully containerized with health checks and volume support.

## Tech Stack

- **Runtime**: Node.js (TypeScript)
- **Framework**: Express.js
- **Database**: PostgreSQL 15 (PostGIS enabled for UUIDs or similar)
- **Containerization**: Docker & Docker Compose
- **Testing**: Python (Requests)

## Getting Started

### Prerequisites

- Docker & Docker Compose
- Python 3 (for running tests)

### Setup

1. **Clone the repository** (if applicable).
2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
3. **Start the services**:
   ```bash
   docker-compose up -d --build
   ```
4. **Access the API**: The server will be running on `http://localhost:8080` (or `http://localhost:3000` as mapped in `docker-compose.yml`).

## API Endpoints

### Command Side (Writes)

- `POST /api/accounts`: Create a new bank account.
- `POST /api/accounts/:id/deposit`: Deposit money.
- `POST /api/accounts/:id/withdraw`: Withdraw money.
- `POST /api/accounts/:id/close`: Close an account (must have zero balance).

### Query Side (Reads)

- `GET /api/accounts/:id`: Get current account summary.
- `GET /api/accounts/:id/events`: Get full event history.
- `GET /api/accounts/:id/transactions`: Get paginated transaction history.
- `GET /api/accounts/:id/balance-at/:timestamp`: Get balance at a specific point in time.

### Maintenance

- `GET /api/projections/status`: Check projection health and lag.
- `POST /api/projections/rebuild`: Trigger a full rebuild of read models.

## Training / Testing

Run the automated test suite:
```bash
python test_api.py
python verify_advanced.py
```

## Architecture Details

- **Event Store**: Implemented in `src/lib/EventStore.ts`, handles persistence and optimistic concurrency control.
- **Aggregate**: Implemented in `src/domain/BankAccount.ts`, contains business logic and state transitions from events.
- **Projector**: Implemented in `src/lib/Projector.ts`, synchronously updates read models.
- **Snapshotting**: Managed in `src/routes.ts`, persisting state to the `snapshots` table every 50 events.
