import pool from '../config/database.js';
import { DomainEvent, EventType } from '../types.js';

export class EventStore {
    async save(event: DomainEvent): Promise<void> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Check for concurrency violation using event_number (per requirement 4 UNIQUE constraint)
            const checkQuery = `SELECT 1 FROM events WHERE aggregate_id = $1 AND event_number = $2`;
            const checkResult = await client.query(checkQuery, [event.aggregateId, event.eventNumber]);

            if (checkResult.rowCount && checkResult.rowCount > 0) {
                throw new Error(`Concurrency conflict: Event number ${event.eventNumber} already exists for aggregate ${event.aggregateId}`);
            }

            const query = `
        INSERT INTO events (
          event_id, aggregate_id, aggregate_type, event_type, event_data, event_number, version, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;

            const values = [
                event.eventId,
                event.aggregateId,
                event.aggregateType,
                event.eventType,
                JSON.stringify(event.eventData),
                event.eventNumber,
                event.version,
                event.timestamp
            ];

            await client.query(query, values);

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getEvents(aggregateId: string, fromVersion: number = 0): Promise<DomainEvent[]> {
        const query = `
      SELECT * FROM events 
      WHERE aggregate_id = $1 AND version > $2
      ORDER BY version ASC
    `;
        const result = await pool.query(query, [aggregateId, fromVersion]);

        return result.rows.map(row => ({
            eventId: row.event_id,
            aggregateId: row.aggregate_id,
            aggregateType: row.aggregate_type,
            eventType: row.event_type as EventType,
            eventData: row.event_data,
            eventNumber: row.event_number,
            version: row.version,
            timestamp: row.timestamp
        }));
    }

    async saveSnapshot(aggregateId: string, snapshotData: any, lastEventNumber: number): Promise<void> {
        const query = `
        INSERT INTO snapshots (aggregate_id, snapshot_data, last_event_number)
        VALUES ($1, $2, $3)
        ON CONFLICT (aggregate_id) DO UPDATE
        SET snapshot_data = $2, last_event_number = $3, created_at = NOW()
      `;
        await pool.query(query, [aggregateId, JSON.stringify(snapshotData), lastEventNumber]);
    }

    async getSnapshot(aggregateId: string): Promise<{ data: any, lastEventNumber: number } | null> {
        const query = `SELECT * FROM snapshots WHERE aggregate_id = $1`;
        const res = await pool.query(query, [aggregateId]);
        if (res.rows.length === 0) return null;
        return {
            data: res.rows[0].snapshot_data,
            lastEventNumber: res.rows[0].last_event_number
        };
    }
}
