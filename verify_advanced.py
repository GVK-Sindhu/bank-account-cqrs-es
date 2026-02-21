import requests
import json
import time
import uuid
import urllib.parse
from datetime import datetime, timezone

BASE_URL = "http://localhost:3000/api"

def test_pagination():
    print("\n[STEP] Testing Pagination")
    account_id = f"pag-{uuid.uuid4()}"
    requests.post(f"{BASE_URL}/accounts", json={
        "accountId": account_id, "ownerName": "Pag User", "initialBalance": 0, "currency": "USD"
    })
    
    # Perform 12 transactions (deposits)
    for i in range(12):
        tx_id = f"tx-pag-{i}-{uuid.uuid4()}"
        requests.post(f"{BASE_URL}/accounts/{account_id}/deposit", json={
            "amount": 10,
            "description": f"tx {i}",
            "transactionId": tx_id
        })
    
    # Get page 2 with page size 10. Total 12 transactions -> Page 1: 10, Page 2: 2.
    response = requests.get(f"{BASE_URL}/accounts/{account_id}/transactions?page=2&pageSize=10")
    if response.status_code == 200:
        data = response.json()
        print(f"Current Page: {data['currentPage']}, Items: {len(data['items'])}")
        if data['currentPage'] == 2 and len(data['items']) == 2:
             print("[OK] Pagination works.")
        else:
             print(f"[X] Pagination mismatch. Got {len(data['items'])} items on page 2")
    else:
        print(f"[X] Failed pagination. {response.text}")

def test_time_travel():
    print("\n[STEP] Testing Time Travel")
    # Create new account for clean timeline
    aid = f"tt-{uuid.uuid4()}"
    requests.post(f"{BASE_URL}/accounts", json={
        "accountId": aid, "ownerName": "Time Traveller", "initialBalance": 100, "currency": "USD"
    })
    
    # Wait much longer to ensure host clock is ahead of DB creation timestamp (skew observed)
    print("Waiting for creation to settle in DB (20s)...")
    time.sleep(20)
    t1 = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    print(f"T1: {t1}")
    print("Waiting for T1 to pass in DB (20s)...")
    time.sleep(20)
    
    requests.post(f"{BASE_URL}/accounts/{aid}/deposit", json={
        "amount": 50, "description": "T2 deposit", "transactionId": f"tx-tt-{uuid.uuid4()}"
    })
    
    # Wait for projection
    time.sleep(2)
    
    # Query at T1
    encoded_t1 = urllib.parse.quote(t1)
    response = requests.get(f"{BASE_URL}/accounts/{aid}/balance-at/{encoded_t1}")
    if response.status_code == 200:
        data = response.json()
        print(f"Balance at T1: {data['balanceAt']}")
        if float(data['balanceAt']) == 100.0:
            print("[OK] Time travel balance correct.")
        else:
            print(f"[X] Time travel mismatch. Expected 100, got {data['balanceAt']}")
    else:
        print(f"[X] Time travel failed. {response.text}")

def test_projection_rebuild():
    print("\n[STEP] Testing Projection Rebuild")
    requests.post(f"{BASE_URL}/projections/rebuild")
    time.sleep(5) # Wait for rebuild to finish (simulated)
    response = requests.get(f"{BASE_URL}/projections/status")
    if response.status_code == 200:
        data = response.json()
        print(f"Total events in store: {data['totalEventsInStore']}")
        if data['projections'][0]['lag'] == 0:
            print("[OK] Projections up to date after rebuild.")
        else:
            print("[X] Projections still lagging.")
    else:
        print(f"[X] Failed to get status. {response.text}")

def test_snapshotting():
    print("\n[STEP] Testing Snapshotting (every 50 events)")
    aid = f"snap-{uuid.uuid4()}"
    requests.post(f"{BASE_URL}/accounts", json={
        "accountId": aid, "ownerName": "Snap User", "initialBalance": 0, "currency": "USD"
    })
    
    # Generate 50 more events (Total 51)
    for i in range(50):
        requests.post(f"{BASE_URL}/accounts/{aid}/deposit", json={
            "amount": 1, "description": f"d {i}", "transactionId": f"tx-snap-{i}-{uuid.uuid4()}"
        })
        if (i+1) % 10 == 0: print(f"Sent {i+1} additional events...")

    # Wait for processing
    time.sleep(2)
    
    response = requests.get(f"{BASE_URL}/accounts/{aid}")
    if response.status_code == 200:
        print(f"Final Balance: {response.json()['balance']}")
        if float(response.json()['balance']) == 50.0:
            print("[OK] Account still correct after many events.")
    
    # Verify events endpoint still returns all 51
    response = requests.get(f"{BASE_URL}/accounts/{aid}/events")
    events = response.json()
    print(f"Events found: {len(events)}")
    if len(events) == 51:
        print("[OK] All events preserved.")

if __name__ == "__main__":
    test_pagination()
    test_time_travel()
    test_projection_rebuild()
    test_snapshotting()
