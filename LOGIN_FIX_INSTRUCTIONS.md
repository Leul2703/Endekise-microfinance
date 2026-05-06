# Login Fix Instructions

The existing users in the database have old weak passwords that don't meet the new complexity requirements. To fix this, you need to reset the seed users.

## Option 1: Reset via API Endpoint (Recommended)

Run this command to reset all users with new strong passwords:

```bash
curl -X POST http://localhost:5000/api/auth/reset-seed-users
```

Or use Postman/Insomnia to POST to `http://localhost:5000/api/auth/reset-seed-users`

This will return the new credentials:
- admin / Admin@Secure2026
- manager / Manager@Secure2026
- loanstaff / LoanStaff@2026
- savingstaff / SavingStaff@2026
- ceo / CEO@Secure2026
- client / Client@Secure2026

## Option 2: Delete Database File

If the API endpoint doesn't work, delete the database file and let it re-seed:

1. Stop the backend server
2. Delete `backend/database.sqlite`
3. Restart the backend server
4. Use the new credentials above

## New Credentials

After reset, use these credentials:

| Username | Password | Role |
|----------|----------|------|
| admin | Admin@Secure2026 | Admin |
| manager | Manager@Secure2026 | Branch Manager |
| loanstaff | LoanStaff@2026 | Loan Staff |
| savingstaff | SavingStaff@2026 | Saving Staff |
| ceo | CEO@Secure2026 | CEO |
| client | Client@Secure2026 | Client |

All new passwords meet the complexity requirements (12+ characters, mixed case, numbers, special characters).
