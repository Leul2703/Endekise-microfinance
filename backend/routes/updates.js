const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { db } = require('../config/database');

// Submit update request (UC-C-002)
router.post('/request', authenticateToken, authorizeRoles('client'), async (req, res) => {
  const { field_name, new_value, explanation, document_ids } = req.body;
  const userId = req.user.id;

  if (!field_name || !new_value) {
    return res.status(400).json({ error: 'Field name and new value are required' });
  }

  // Alternative Flow: Missing Document
  if (!document_ids || document_ids.length === 0) {
    return res.status(400).json({ 
      error: 'Supporting document is required to submit the update request',
      violation_type: 'missing_document'
    });
  }

  try {
    // Get client profile
    const client = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM clients WHERE id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!client) {
      return res.status(404).json({ error: 'Client profile not found' });
    }

    // Get old value
    const oldValue = client[field_name] || null;

    // Generate unique tracking ID
    const trackingId = `UPD-${Date.now()}`;
    const requestId = `REQ-${Date.now()}`;

    // Create update request record
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO update_requests (id, client_id, request_type, field_name, old_value, new_value, explanation, document_ids, status, tracking_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [requestId, userId, 'profile_update', field_name, oldValue, new_value, explanation, JSON.stringify(document_ids), 'Pending Staff Review', trackingId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Place in review queue (approval_requests)
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO approval_requests (id, type, entity_id, requested_by, status, justification) VALUES (?, ?, ?, ?, ?, ?)',
        [trackingId, 'client_update_request', requestId, userId, 'Pending', explanation || 'Client profile update request'],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Send email confirmation to client
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO email_log (recipient_email, subject, body, status) VALUES (?, ?, ?, ?)',
        [`client-${userId}@edekise.com`, `Update Request Confirmation: ${trackingId}`, `Your update request for ${field_name} has been submitted. Tracking ID: ${trackingId}. Status: Pending Staff Review.`, 'Pending'],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log(`[AUDIT] Update request ${trackingId} submitted by client ${userId} for field ${field_name} at ${new Date().toISOString()}`);
    console.log(`[AUDIT] Email confirmation sent to client`);

    res.status(201).json({
      message: 'Update request submitted successfully',
      request_id: requestId,
      tracking_id: trackingId,
      status: 'Pending Staff Review',
      email_confirmation_sent: true
    });
  } catch (error) {
    console.error('Update request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get client's update requests
router.get('/my-requests', authenticateToken, authorizeRoles('client'), async (req, res) => {
  const userId = req.user.id;

  try {
    const requests = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM update_requests WHERE client_id = ? ORDER BY created_at DESC', [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    res.json(requests);
  } catch (error) {
    console.error('Error fetching update requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get pending update requests (for staff review)
router.get('/pending', authenticateToken, authorizeRoles('saving_staff', 'branch_manager'), async (req, res) => {
  try {
    const requests = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM update_requests WHERE status = 'Pending Staff Review'", [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    // Enrich with client details
    const enrichedRequests = await Promise.all(requests.map(async (request) => {
      const client = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM clients WHERE id = ?', [request.client_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      return {
        ...request,
        document_ids: request.document_ids ? JSON.parse(request.document_ids) : [],
        client
      };
    }));

    res.json(enrichedRequests);
  } catch (error) {
    console.error('Error fetching pending update requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve update request
router.post('/:id/approve', authenticateToken, authorizeRoles('saving_staff', 'branch_manager'), async (req, res) => {
  const { id } = req.params;
  const { justification } = req.body;
  const userId = req.user.id;

  if (!justification) {
    return res.status(400).json({ error: 'Justification is required' });
  }

  try {
    // Get update request details
    const request = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM update_requests WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!request) {
      return res.status(404).json({ error: 'Update request not found' });
    }

    // Update client profile
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE clients SET ${request.field_name} = ? WHERE id = ?`,
        [request.new_value, request.client_id],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Update request status
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE update_requests SET status = 'Approved' WHERE id = ?",
        [id],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Update approval request
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE approval_requests SET status = 'Approved' WHERE entity_id = ?",
        [id],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log(`[AUDIT] Update request ${id} approved by user ${userId} at ${new Date().toISOString()}`);

    res.json({ message: 'Update request approved successfully' });
  } catch (error) {
    console.error('Update request approval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject update request
router.post('/:id/reject', authenticateToken, authorizeRoles('saving_staff', 'branch_manager'), async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const userId = req.user.id;

  if (!reason) {
    return res.status(400).json({ error: 'Rejection reason is required' });
  }

  try {
    // Update request status
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE update_requests SET status = 'Rejected' WHERE id = ?",
        [id],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Update approval request
    await new Promise((resolve, reject) => {
      db.run(
        "UPDATE approval_requests SET status = 'Rejected', justification = ? WHERE entity_id = ?",
        [reason, id],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log(`[AUDIT] Update request ${id} rejected by user ${userId} with reason: ${reason} at ${new Date().toISOString()}`);

    res.json({ message: 'Update request rejected successfully' });
  } catch (error) {
    console.error('Update request rejection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
