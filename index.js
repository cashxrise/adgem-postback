const express = require('express');
const admin = require('firebase-admin');
const app = express();

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY;
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);

// Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ✅ Health check for uptime monitoring (UptimeRobot)
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// ✅ Postback endpoint for AdGem
app.get('/adgem', async (req, res) => {
  const { user_id, amount, tx_id, auth } = req.query;

  if (auth !== SECRET_KEY) return res.status(403).send('Unauthorized');
  if (!user_id || !amount || !tx_id) return res.status(400).send('Missing parameters');

  try {
    // Check for duplicate tx_id (optional but highly recommended)
    const txRef = db.collection('adgem_tx').doc(tx_id);
    const txSnap = await txRef.get();

    if (txSnap.exists) {
      return res.status(200).send('Duplicate transaction - already credited');
    }

    // Update user's coin balance
    const userRef = db.collection('users').doc(user_id);
    const userSnap = await userRef.get();

    if (!userSnap.exists) return res.status(404).send('User not found');

    await db.runTransaction(async (t) => {
      t.set(txRef, {
        user_id,
        amount: parseInt(amount),
        createdAt: new Date(),
      });

      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(parseInt(amount)),
      });
    });

    return res.send('Coins updated successfully');
  } catch (err) {
    console.error('AdGem postback error:', err);
    return res.status(500).send('Server error');
  }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
