import requests
import json
import time
import uuid
from datetime import datetime

BASE_URL = "http://localhost:8080/api"

def print_step(message):
    print(f"\n[STEP] {message}")

def print_result(status, message):
    res = "[OK] PASS" if status else "[X] FAIL"
    print(f"{res}: {message}")

def test_create_account():
    print_step("Creating Account")
    account_id = f"acc-{uuid.uuid4()}"
    payload = {
        "accountId": account_id,
        "ownerName": "Test User",
        "initialBalance": 1000,
        "currency": "USD"
    }
    response = requests.post(f"{BASE_URL}/accounts", json=payload)
    
    if response.status_code == 202:
        print_result(True, f"Account {account_id} created.")
        return account_id
    else:
        print_result(False, f"Failed to create account. Status: {response.status_code}, Body: {response.text}")
        return None

def test_deposit(account_id):
    print_step("Depositing Money")
    tx_id = f"tx-{uuid.uuid4()}"
    payload = {
        "amount": 500,
        "description": "Salary",
        "transactionId": tx_id
    }
    response = requests.post(f"{BASE_URL}/accounts/{account_id}/deposit", json=payload)
    if response.status_code == 202:
        print_result(True, "Deposit successful.")
    else:
        print_result(False, f"Deposit failed. {response.text}")

def test_withdraw(account_id):
    print_step("Withdrawing Money")
    tx_id = f"tx-{uuid.uuid4()}"
    payload = {
        "amount": 200,
        "description": "Rent",
        "transactionId": tx_id
    }
    response = requests.post(f"{BASE_URL}/accounts/{account_id}/withdraw", json=payload)
    if response.status_code == 202:
        print_result(True, "Withdrawal successful.")
    else:
        print_result(False, f"Withdrawal failed. {response.text}")

def test_get_summary(account_id, expected_balance):
    print_step("Checking Account Summary")
    # Wait a bit for projection if async (though ours is sync)
    time.sleep(0.5) 
    response = requests.get(f"{BASE_URL}/accounts/{account_id}")
    if response.status_code == 200:
        data = response.json()
        print(f"Current Balance: {data['balance']}")
        if float(data['balance']) == float(expected_balance):
            print_result(True, "Balance matches expected value.")
        else:
            print_result(False, f"Balance mismatch. Expected {expected_balance}, got {data['balance']}")
    else:
        print_result(False, "Failed to get summary.")

def test_get_events(account_id, min_events):
    print_step("Checking Event Stream")
    response = requests.get(f"{BASE_URL}/accounts/{account_id}/events")
    if response.status_code == 200:
        events = response.json()
        print(f"Events found: {len(events)}")
        if len(events) >= min_events:
             print_result(True, "Correct number of events found.")
        else:
             print_result(False, f"Expected at least {min_events} events.")
    else:
        print_result(False, "Failed to get events.")

def test_create_duplicate(account_id):
    print_step("Creating Duplicate Account (Expect Failure)")
    payload = {
        "accountId": account_id,
        "ownerName": "Test User",
        "initialBalance": 1000,
        "currency": "USD"
    }
    response = requests.post(f"{BASE_URL}/accounts", json=payload)
    if response.status_code == 409:
        print_result(True, "Duplicate creation rejected (409).")
    else:
        print_result(False, f"Expected 409, got {response.status_code}")

def test_overdraft(account_id):
    print_step("Overdraft Withdrawal (Expect Failure)")
    tx_id = f"tx-{uuid.uuid4()}"
    payload = {
        "amount": 100000,
        "description": "Overdraft",
        "transactionId": tx_id
    }
    response = requests.post(f"{BASE_URL}/accounts/{account_id}/withdraw", json=payload)
    if response.status_code == 409:
        print_result(True, "Overdraft rejected (409).")
    else:
        print_result(False, f"Expected 409, got {response.status_code}")

def test_close_non_zero(account_id):
    print_step("Close Non-Zero Balance (Expect Failure)")
    response = requests.post(f"{BASE_URL}/accounts/{account_id}/close", json={"reason": "test"})
    if response.status_code == 409:
        print_result(True, "Close non-zero rejected (409).")
    else:
        print_result(False, f"Expected 409, got {response.status_code}")

def test_close_success(account_id):
    print_step("Close Zero Balance (Expect Success)")
    # Withdraw all first
    # Current balance is 1300 from previous steps
    tx_id = f"tx-{uuid.uuid4()}"
    requests.post(f"{BASE_URL}/accounts/{account_id}/withdraw", json={
        "amount": 1300,
        "description": "Emptying",
        "transactionId": tx_id
    })
    
    response = requests.post(f"{BASE_URL}/accounts/{account_id}/close", json={"reason": "done"})
    if response.status_code == 202:
        print_result(True, "Account closed successfully.")
    else:
        print_result(False, f"Expected 202, got {response.status_code}")

def run_tests():
    try:
        # Check Health
        health = requests.get(f"http://localhost:8080/health")
        if health.status_code != 200:
            print("[X] API is not healthy or reachable. Is Docker running?")
            return
            
        aid = test_create_account()
        if not aid: return

        test_create_duplicate(aid)

        # Initial: 1000
        test_get_summary(aid, 1000)

        # Deposit: +500 -> 1500
        test_deposit(aid)
        test_get_summary(aid, 1500)

        # Withdraw: -200 -> 1300
        test_withdraw(aid)
        test_get_summary(aid, 1300)

        test_overdraft(aid)

        test_close_non_zero(aid)

        test_close_success(aid)

        # Events: Created, Deposited, Withdrawn, Withdrawn(Emptying), Closed -> 5 events
        test_get_events(aid, 5)
        
        print("\n[OK] All basic tests completed.")
        
    except Exception as e:
        print(f"\n[X] Exception during testing: {e}")

if __name__ == "__main__":
    run_tests()
