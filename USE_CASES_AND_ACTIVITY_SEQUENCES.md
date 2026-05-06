# Edekise Microfinance System - Use Cases and Activity Sequences

## Table of Contents
1. [User Roles and Use Cases](#user-roles-and-use-cases)
2. [Authentication Activity Sequences](#authentication-activity-sequences)
3. [Loan Management Activity Sequences](#loan-management-activity-sequences)
4. [Savings Management Activity Sequences](#savings-management-activity-sequences)
5. [Financial Transaction Activity Sequences](#financial-transaction-activity-sequences)
6. [Approval Workflow Activity Sequences](#approval-workflow-activity-sequences)
7. [CEO Operations Activity Sequences](#ceo-operations-activity-sequences)
8. [Document Management Activity Sequences](#document-management-activity-sequences)
9. [Statement Generation Activity Sequences](#statement-generation-activity-sequences)
10. [Update Request Activity Sequences](#update-request-activity-sequences)

---

## User Roles and Use Cases

### 1. Admin (System Administrator)
**Use Cases:**
- UC-ADM-001: Create and manage user accounts
- UC-ADM-002: Assign roles and permissions
- UC-ADM-003: View system audit logs
- UC-ADM-004: Delete user accounts (with secondary authentication)
- UC-ADM-005: Manage branch information
- UC-ADM-006: Reset seed users (development only)

### 2. CEO (Chief Executive Officer)
**Use Cases:**
- UC-CEO-001: View system-wide reports and statistics
- UC-CEO-002: Perform balance adjustments (with secondary authentication)
- UC-CEO-003: Review and approve escalated requests
- UC-CEO-004: Access risk assessment reports
- UC-CEO-005: View branch performance metrics

### 3. Branch Manager
**Use Cases:**
- UC-BM-001: Approve/reject loan applications
- UC-BM-002: Approve/reject savings accounts
- UC-BM-003: Escalate policy violations to CEO
- UC-BM-004: Authorize statement requests
- UC-BM-005: Review pending update requests
- UC-BM-006: View branch statistics

### 4. Loan Staff
**Use Cases:**
- UC-LS-001: Create loan applications
- UC-LS-002: Upload loan documents
- UC-LS-003: Verify client documents
- UC-LS-004: Generate payment schedules
- UC-LS-005: View pending loan approvals
- UC-LS-006: Escalate loans to CEO (high-value)

### 5. Saving Staff
**Use Cases:**
- UC-SS-001: Create savings accounts
- UC-SS-002: Process deposits and withdrawals
- UC-SS-003: Review client update requests
- UC-SS-004: Approve/reject profile updates
- UC-SS-005: View pending savings approvals

### 6. Client
**Use Cases:**
- UC-C-001: Login and view account information
- UC-C-002: Request profile updates
- UC-C-003: View loan and savings statements
- UC-C-004: Submit update requests with documents
- UC-C-005: Track update request status

---

## Authentication Activity Sequences

### AS-001: User Login
**Actors:** All Users
**Preconditions:** User account exists and is Active

**Activity Sequence:**
1. User enters username and password
2. System validates input fields
3. System queries database for user
4. System verifies password using bcrypt
5. **If login fails:**
   - Increment login_attempts counter
   - **If 5 failed attempts:**
     - Lock account for 30 minutes
     - Set locked_until timestamp
     - Return error: "Account locked. Try again later"
   - Return error: "Invalid credentials"
6. **If login succeeds:**
   - Reset login_attempts to 0
   - Generate JWT token with role-based expiry:
     - CEO: 1 hour
     - Branch Manager: 15 minutes
     - Loan Staff: 15 minutes
     - Saving Staff: 15 minutes
     - Client: 30 minutes
   - Log successful login to audit_trail
   - Return token and user information

**Postconditions:** User authenticated with valid JWT token

---

### AS-002: Account Lockout and Unlock
**Actors:** Admin, Locked Users
**Preconditions:** Account is locked due to failed login attempts

**Activity Sequence:**
1. User attempts login
2. System detects locked_until timestamp
3. **If current time < locked_until:**
   - Return error: "Account locked. Try again in X minutes"
4. **If current time >= locked_until:**
   - Auto-unlock account
   - Reset login_attempts to 0
   - Clear locked_until timestamp
   - Proceed with normal login flow

**Admin Unlock Sequence:**
1. Admin requests account unlock via `/api/auth/unlock/:username`
2. System verifies admin role
3. System resets login_attempts to 0
4. System clears locked_until timestamp
5. System logs unlock action to audit_trail
6. Return success message

---

### AS-003: Password Reset Request
**Actors:** All Users
**Preconditions:** User has valid email address

**Activity Sequence:**
1. User requests password reset via email
2. System validates email format
3. System queries database for user by email
4. **If user not found:**
   - Return generic success (prevent email enumeration)
5. **If user found:**
   - Generate secure reset token using crypto
   - Set token expiry to 1 hour
   - Store token and expiry in database
   - Generate reset link with token
   - Send email with reset link via emailService
   - Log reset request to audit_trail
   - Return generic success message

**Postconditions:** Reset token stored and email sent

---

### AS-004: Password Reset Confirmation
**Actors:** All Users
**Preconditions:** Valid reset token exists

**Activity Sequence:**
1. User submits new password with token
2. System validates token existence and expiry
3. **If token invalid or expired:**
   - Return error: "Invalid or expired token"
4. **If token valid:**
   - Validate password complexity:
     - Minimum 12 characters
     - At least one lowercase letter
     - At least one uppercase letter
     - At least one number
     - At least one special character
     - Not in common weak passwords list
   - **If validation fails:**
     - Return error with specific requirements
   - **If validation passes:**
     - Hash new password using bcrypt
     - Update user password in database
     - Clear reset token and expiry
     - Send confirmation email via emailService
     - Log password reset to audit_trail
     - Return success message

**Postconditions:** Password updated and token cleared

---

## Loan Management Activity Sequences

### AS-LM-001: Create Loan Application
**Actors:** Loan Staff
**Preconditions:** Client exists, user authenticated as Loan Staff

**Activity Sequence:**
1. Loan Staff submits loan application with:
   - Client ID
   - Principal amount
   - Interest rate
   - Term (months)
   - Loan type
   - Document IDs
2. System validates input fields
3. System validates policy limits:
   - Principal amount ≤ 500,000 ETB
   - Interest rate between 5% and 25%
4. System verifies all required documents exist
5. **If policy violation detected:**
   - Return error with violation details
   - Allow escalation to CEO
6. **If validation passes:**
   - Generate unique loan ID
   - Create loan account with status "Pending"
   - Generate payment schedule using amortization formula
   - Store payment schedule entries
   - Log loan creation to audit_trail
   - Return loan ID and payment schedule

**Postconditions:** Loan account created in Pending status

---

### AS-LM-002: Loan Approval by Branch Manager
**Actors:** Branch Manager
**Preconditions:** Loan in Pending status, user authenticated as Branch Manager

**Activity Sequence:**
1. Branch Manager views pending loan approvals
2. Branch Manager selects loan for approval
3. Branch Manager provides justification (mandatory)
4. System validates justification length (minimum 10 characters)
5. **If validation fails:**
   - Return error: "Justification required (minimum 10 characters)"
6. **If validation passes:**
   - Update loan status to "Active"
   - Log approval to audit_trail
   - Notify Loan Staff of approval
   - Return success message

**Postconditions:** Loan status changed to Active

---

### AS-LM-003: Loan Rejection by Branch Manager
**Actors:** Branch Manager
**Preconditions:** Loan in Pending status

**Activity Sequence:**
1. Branch Manager selects loan for rejection
2. Branch Manager provides rejection reason (mandatory)
3. System validates reason length (minimum 10 characters)
4. **If validation fails:**
   - Return error: "Rejection reason required (minimum 10 characters)"
5. **If validation passes:**
   - Update loan status to "Rejected"
   - Log rejection to audit_trail
   - Notify Loan Staff of rejection
   - Return success message

**Postconditions:** Loan status changed to Rejected

---

### AS-LM-004: Escalate Policy Violation to CEO
**Actors:** Loan Staff, Branch Manager
**Preconditions:** Loan violates policy (e.g., high interest rate, large principal)

**Activity Sequence:**
1. User initiates escalation for loan
2. User provides escalation reason (mandatory, minimum 10 characters)
3. System validates reason length
4. **If validation fails:**
   - Return error: "Escalation reason required (minimum 10 characters)"
5. **If validation passes:**
   - Create approval request with type "ceo_loan_approval"
   - Link to loan account
   - Set status to "Pending"
   - Include violation details
   - Log escalation to audit_trail
   - Return approval request ID

**Postconditions:** Approval request created for CEO review

---

### AS-LM-005: CEO Approval of Escalated Loan
**Actors:** CEO
**Preconditions:** Approval request in Pending status

**Activity Sequence:**
1. CEO views pending escalated requests
2. CEO selects request for approval
3. CEO provides justification (mandatory)
4. System validates justification length
5. **If validation passes:**
   - Update approval request status to "Approved"
   - Update loan status to "Active"
   - Log CEO approval to audit_trail
   - Notify Branch Manager of approval
   - Return success message

**Postconditions:** Loan approved and activated

---

### AS-LM-006: Generate Payment Schedule
**Actors:** Loan Staff
**Preconditions:** Loan account exists

**Activity Sequence:**
1. Loan Staff submits payment schedule parameters:
   - Loan ID
   - Principal amount
   - Interest rate
   - Term (months)
   - Start date
2. System calculates monthly payment using amortization formula:
   - Monthly interest rate = Annual rate / 12
   - Monthly payment = P × [r(1+r)^n] / [(1+r)^n - 1]
3. System generates schedule entries for each month:
   - Calculate interest portion
   - Calculate principal portion
   - Calculate remaining balance
   - Set due date
4. System stores all schedule entries
5. System log schedule generation to audit_trail
6. Return complete payment schedule

**Postconditions:** Payment schedule generated and stored

---

## Savings Management Activity Sequences

### AS-SM-001: Create Savings Account
**Actors:** Saving Staff
**Preconditions:** Client exists, user authenticated as Saving Staff

**Activity Sequence:**
1. Saving Staff submits savings account with:
   - Client ID
   - Initial amount
   - Account type
   - Interest rate
   - Maturity date (if applicable)
2. System validates input fields
3. System checks for compliance flags:
   - If initial deposit > 100,000 ETB: Set compliance_flag to "High Deposit"
4. System creates savings account with status "Pending"
5. System logs account creation to audit_trail
6. Return account ID

**Postconditions:** Savings account created in Pending status

---

### AS-SM-002: Submit Savings for Approval
**Actors:** Saving Staff
**Preconditions:** Savings account in Pending status

**Activity Sequence:**
1. Saving Staff submits account for manager review
2. System verifies mandatory KYC documents exist for client
3. **If documents missing:**
   - Return error: "Missing mandatory KYC documents"
4. **If documents present:**
   - Update account status to "Submitted for Approval"
   - Log submission to audit_trail
   - Return success message

**Postconditions:** Account submitted for manager review

---

### AS-SM-003: Approve Savings Account
**Actors:** Branch Manager
**Preconditions:** Account in "Submitted for Approval" status

**Activity Sequence:**
1. Branch Manager views pending savings approvals
2. Branch Manager selects account for approval
3. Branch Manager provides justification (mandatory)
4. **If compliance_flag is "High Deposit":**
   - Branch Manager must provide expanded justification
   - System sets override_compliance flag
5. System validates justification length
6. **If validation passes:**
   - Update account status to "Active"
   - Log approval to audit_trail
   - Notify Saving Staff of approval
   - Return success message

**Postconditions:** Savings account activated

---

### AS-SM-004: Reject Savings Account
**Actors:** Branch Manager
**Preconditions:** Account in "Submitted for Approval" status

**Activity Sequence:**
1. Branch Manager selects account for rejection
2. Branch Manager provides rejection reason (mandatory)
3. System validates reason length
4. **If validation passes:**
   - Update account status to "Rejected"
   - Log rejection to audit_trail
   - Notify Saving Staff of rejection
   - Return success message

**Postconditions:** Savings account rejected

---

## Financial Transaction Activity Sequences

### AS-FT-001: Deposit to Savings Account
**Actors:** Saving Staff
**Preconditions:** Savings account exists and is Active

**Activity Sequence:**
1. Saving Staff initiates deposit with:
   - Account ID
   - Amount
   - Description
2. System validates positive amount
3. System begins database transaction
4. System retrieves current account balance
5. System validates deposit limit (≤ 1,000,000 ETB)
6. **If validation fails:**
   - Rollback transaction
   - Return error: "Deposit exceeds limit"
7. **If validation passes:**
   - Calculate new balance = current + amount
   - Update account balance
   - Record transaction in transactions table
   - Commit transaction
   - Log deposit to audit_trail
   - Return transaction details

**Postconditions:** Balance updated, transaction recorded

---

### AS-FT-002: Withdraw from Savings Account
**Actors:** Saving Staff
**Preconditions:** Savings account exists and is Active

**Activity Sequence:**
1. Saving Staff initiates withdrawal with:
   - Account ID
   - Amount
   - Description
2. System validates positive amount
3. System begins database transaction
4. System retrieves current account balance
5. System validates sufficient balance (amount ≤ balance)
6. **If validation fails:**
   - Rollback transaction
   - Return error: "Insufficient balance"
7. **If validation passes:**
   - Calculate new balance = current - amount
   - Update account balance
   - Record transaction in transactions table
   - Commit transaction
   - Log withdrawal to audit_trail
   - Return transaction details

**Postconditions:** Balance updated, transaction recorded

---

### AS-FT-003: Loan Payment
**Actors:** Saving Staff
**Preconditions:** Loan account exists and is Active

**Activity Sequence:**
1. Saving Staff initiates payment with:
   - Account ID
   - Amount
   - Description
2. System validates positive amount
3. System begins database transaction
4. System retrieves current loan balance
5. System validates payment ≤ outstanding balance
6. **If validation fails:**
   - Rollback transaction
   - Return error: "Payment exceeds outstanding balance"
7. **If validation passes:**
   - Calculate new balance = current - amount
   - Update loan balance
   - Record transaction in transactions table
   - Commit transaction
   - Log payment to audit_trail
   - Return transaction details

**Postconditions:** Loan balance updated, transaction recorded

---

### AS-FT-004: Advance Payment (Multi-Month)
**Actors:** Saving Staff
**Preconditions:** Loan has pending payment schedule entries

**Activity Sequence:**
1. Saving Staff initiates advance payment with:
   - Loan ID
   - Amount
2. System validates positive amount
3. System retrieves pending payment schedule entries (chronological order)
4. System applies payment to schedule entries:
   - For each entry:
     - If remaining amount ≥ entry total: Mark as Paid
     - If remaining amount < entry total: Mark as Partial
5. System updates loan balance by total applied amount
6. System records transaction
7. System logs advance payment to audit_trail
8. Return payment details with marked schedule entries

**Postconditions:** Multiple schedule entries updated, balance reduced

---

## Approval Workflow Activity Sequences

### AS-AW-001: Submit Statement Request
**Actors:** Loan Staff, Saving Staff
**Preconditions:** Account exists, user authenticated

**Activity Sequence:**
1. User submits statement request with:
   - Client ID
   - Account ID (loan or savings)
   - Start date
   - End date
2. System validates date range:
   - End date cannot be in future
   - Start date must be before end date
3. **If date range ≥ 24 months:**
   - Set extended_range_flag to "Extended"
   - Add warning for manager review
4. System retrieves transactions for period
5. System retrieves payment schedule (for loans)
6. System formats statement data
7. System creates statement record with status "Pending"
8. System creates approval request for manager review
9. System logs statement request to audit_trail
10. Return statement ID and request ID

**Postconditions:** Statement created, awaiting manager authorization

---

### AS-AW-002: Authorize Statement
**Actors:** Branch Manager
**Preconditions:** Statement in Pending status

**Activity Sequence:**
1. Branch Manager views pending statement approvals
2. Branch Manager selects statement for authorization
3. **If extended_range_flag is "Extended":**
   - Branch Manager reviews with extra care
4. Branch Manager authorizes statement
5. System updates statement status to "Finalized"
6. System updates approval request status to "Approved"
7. System applies digital signature
8. System logs authorization to audit_trail
9. Return success with digital signature

**Postconditions:** Statement finalized and digitally signed

---

### AS-AW-003: Reject Statement
**Actors:** Branch Manager
**Preconditions:** Statement in Pending status

**Activity Sequence:**
1. Branch Manager selects statement for rejection
2. Branch Manager provides rejection reason (mandatory, minimum 10 characters)
3. System validates reason length
4. **If validation passes:**
   - Update statement status to "Rejected"
   - Update approval request with rejection reason
   - Log rejection to audit_trail
   - Return success with routing information

**Postconditions:** Statement rejected, routed back to staff

---

## CEO Operations Activity Sequences

### AS-CEO-001: Balance Adjustment
**Actors:** CEO
**Preconditions:** User authenticated as CEO, secondary authentication required

**Activity Sequence:**
1. CEO initiates balance adjustment with:
   - Account ID
   - Account type (loan/savings)
   - Adjustment type (credit/debit)
   - Amount
   - Justification (mandatory, minimum 20 characters)
   - Secondary authentication token
2. System validates secondary authentication
3. **If validation fails:**
   - Return error: "Secondary authentication required"
4. System validates justification length
5. **If validation fails:**
   - Return error: "Justification required (minimum 20 characters)"
6. System retrieves current account balance
7. System calculates proposed final balance
8. System previews adjustment to CEO
9. CEO confirms adjustment
10. System updates account balance
11. System records transaction with CEO signature
12. System creates high-security audit log entry
13. System notifies Branch Manager via email
14. System logs adjustment to audit_trail
15. Return transaction details and digital signature

**Postconditions:** Balance adjusted, audit trail created, manager notified

---

### AS-CEO-002: Preview Balance Adjustment
**Actors:** CEO
**Preconditions:** User authenticated as CEO

**Activity Sequence:**
1. CEO submits adjustment parameters (without confirmation)
2. System retrieves current account balance
3. System calculates proposed final balance
4. System returns preview without making changes:
   - Current balance
   - Adjustment type
   - Adjustment amount
   - Proposed final balance

**Postconditions:** Preview returned, no changes made

---

### AS-CEO-003: View CEO Reports
**Actors:** CEO
**Preconditions:** User authenticated as CEO

**Activity Sequence:**
1. CEO requests system reports
2. System calculates system-wide statistics:
   - Total loan portfolio
   - Total clients
   - Active loans count
   - Total savings
3. System retrieves branch performance data
4. System generates report with:
   - Summary statistics
   - Branch details
   - Generated timestamp
5. System returns report data

**Postconditions:** Report generated and returned

---

### AS-CEO-004: View Risk Assessment Report
**Actors:** CEO
**Preconditions:** User authenticated as CEO

**Activity Sequence:**
1. CEO requests risk assessment
2. System retrieves overdue loans
3. System retrieves high-interest loans (>20%)
4. System calculates risk metrics:
   - Overdue loans count
   - Overdue percentage
   - High-interest loans count
   - Risk level (High/Medium/Low)
5. System generates recommendations based on risk level
6. System returns risk assessment report

**Postconditions:** Risk assessment generated with recommendations

---

## Document Management Activity Sequences

### AS-DM-001: Upload Document
**Actors:** Loan Staff
**Preconditions:** Client exists, user authenticated

**Activity Sequence:**
1. Loan Staff selects file for upload
2. System validates file size (≤ 5MB)
3. **If size exceeds limit:**
   - Return error: "File size exceeds 5MB limit"
4. System validates file type (PDF or JPEG only)
5. System validates file content using magic numbers:
   - PDF: %PDF
   - JPEG: FF D8 FF
6. **If content validation fails:**
   - Return error: "Invalid file type (spoofing detected)"
7. System generates unique document ID
8. System stores file in uploads directory
9. System creates document record with status "Pending"
10. System logs upload to audit_trail
11. Return document ID

**Postconditions:** Document uploaded and stored

---

### AS-DM-002: Verify Document
**Actors:** Loan Staff
**Preconditions:** Document in Pending status

**Activity Sequence:**
1. Loan Staff selects document for verification
2. System updates document status to "Verified"
3. System logs verification to audit_trail
4. Return success message

**Postconditions:** Document verified

---

### AS-DM-003: Reject Document
**Actors:** Loan Staff
**Preconditions:** Document in Pending or Verified status

**Activity Sequence:**
1. Loan Staff selects document for rejection
2. Loan Staff provides rejection reason
3. System updates document status to "Rejected"
4. System logs rejection to audit_trail
5. Return success message

**Postconditions:** Document rejected

---

### AS-DM-004: Delete Document
**Actors:** Loan Staff
**Preconditions:** Document exists

**Activity Sequence:**
1. Loan Staff requests document deletion
2. System deletes file from uploads directory
3. System deletes document record from database
4. System logs deletion to audit_trail
5. Return success message

**Postconditions:** Document deleted

---

## Statement Generation Activity Sequences

### AS-SG-001: Generate Loan Statement
**Actors:** Loan Staff, Client
**Preconditions:** Loan account exists

**Activity Sequence:**
1. User requests loan statement for loan ID
2. System retrieves loan account details
3. System retrieves payment schedule
4. System retrieves transaction history
5. System calculates summary:
   - Total amount
   - Balance remaining
   - Payments made
   - Payments remaining
6. System formats statement data
7. System returns complete statement

**Postconditions:** Statement generated and returned

---

### AS-SG-002: Generate Savings Statement
**Actors:** Saving Staff, Client
**Preconditions:** Savings account exists

**Activity Sequence:**
1. User requests savings statement for account ID
2. System retrieves savings account details
3. System retrieves transaction history
4. System calculates summary:
   - Current balance
   - Total deposits
   - Total withdrawals
   - Total transactions
5. System formats statement data
6. System returns complete statement

**Postconditions:** Statement generated and returned

---

## Update Request Activity Sequences

### AS-UR-001: Submit Profile Update Request
**Actors:** Client
**Preconditions:** Client authenticated, profile exists

**Activity Sequence:**
1. Client submits update request with:
   - Field name to update
   - New value
   - Explanation
   - Document IDs (supporting documents)
2. System validates required fields
3. **If documents missing:**
   - Return error: "Supporting document required"
4. System retrieves current value from profile
5. System generates tracking ID
6. System creates update request with status "Pending Staff Review"
7. System creates approval request
8. System sends email confirmation to client
9. System logs request to audit_trail
10. Return tracking ID

**Postconditions:** Update request submitted, awaiting staff review

---

### AS-UR-002: Approve Update Request
**Actors:** Saving Staff, Branch Manager
**Preconditions:** Request in "Pending Staff Review" status

**Activity Sequence:**
1. Staff views pending update requests
2. Staff selects request for approval
3. Staff provides justification (mandatory)
4. System validates justification
5. **If validation passes:**
   - Update client profile field with new value
   - Update request status to "Approved"
   - Update approval request status to "Approved"
   - Log approval to audit_trail
   - Return success message

**Postconditions:** Profile updated, request approved

---

### AS-UR-003: Reject Update Request
**Actors:** Saving Staff, Branch Manager
**Preconditions:** Request in "Pending Staff Review" status

**Activity Sequence:**
1. Staff selects request for rejection
2. Staff provides rejection reason (mandatory)
3. System validates reason
4. **If validation passes:**
   - Update request status to "Rejected"
   - Update approval request with rejection reason
   - Log rejection to audit_trail
   - Return success message

**Postconditions:** Request rejected

---

### AS-UR-004: View My Update Requests
**Actors:** Client
**Preconditions:** Client authenticated

**Activity Sequence:**
1. Client requests their update requests
2. System retrieves all requests for client ID
3. System returns requests with status and details

**Postconditions:** Request history returned

---

## System-Wide Activity Sequences

### AS-SW-001: Data Retention Policy Enforcement
**Actors:** System (Scheduled Job)
**Frequency:** Daily at midnight

**Activity Sequence:**
1. System calculates cutoff date (1 year ago for audit logs)
2. System deletes audit_trail entries older than cutoff
3. System calculates email cutoff date (6 months ago)
4. System deletes email_log entries older than email cutoff
5. System logs deletion counts to console
6. System continues normal operation

**Postconditions:** Old data purged according to retention policy

---

### AS-SW-002: Payment Reminder Scheduler
**Actors:** System (Scheduled Job)
**Frequency:** Daily at 8:00 AM

**Activity Sequence:**
1. System queries payment_schedule for payments due in next 3 days
2. System joins with loan_accounts and clients tables
3. For each due payment:
   - System generates reminder email
   - System sends email via emailService
4. System logs reminder count to console
5. System continues normal operation

**Postconditions:** Payment reminders sent to clients

---

## Error Handling Activity Sequences

### AS-EH-001: Database Transaction Rollback
**Actors:** System
**Trigger:** Error during financial transaction

**Activity Sequence:**
1. Error detected during transaction
2. System initiates ROLLBACK
3. System logs error to console
4. System returns error response to client
5. System ensures no partial data committed

**Postconditions:** Transaction rolled back, data integrity maintained

---

### AS-EH-002: Rate Limit Exceeded
**Actors:** System
**Trigger:** Request rate exceeds configured limit

**Activity Sequence:**
1. System detects rate limit exceeded
2. System returns 429 status code
3. System includes retry-after information
4. System logs rate limit event
5. System continues normal operation

**Postconditions:** Request rejected, client informed of rate limit

---

### AS-EH-003: JWT Token Expired
**Actors:** System
**Trigger:** JWT token validation fails due to expiry

**Activity Sequence:**
1. System detects expired token
2. System returns 401 status code
3. System includes error: "Token expired"
4. System logs authentication failure
5. Client must re-authenticate

**Postconditions:** Authentication required

---

## Summary

This document outlines all use cases and activity sequences for the Edekise Microfinance System. Each activity sequence includes:
- Actors involved
- Preconditions
- Step-by-step activity flow
- Postconditions
- Error handling where applicable

The system implements comprehensive audit logging, role-based access control, and transaction integrity for all financial operations. All sensitive operations require appropriate authorization and justification.
