const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');
const app = express();

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY;
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);

// ✅ Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// ✅ UptimeRobot health check
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// ✅ AdGem Postback Endpoint
app.get('/adgem', async (req, res) => {
  const { user_id, amount, tx_id, auth } = req.query;

  if (auth !== SECRET_KEY) return res.status(403).send('Unauthorized');
  if (!user_id || !amount || !tx_id) return res.status(400).send('Missing parameters');

  try {
    const txRef = db.collection('adgem_tx').doc(tx_id);
    const txSnap = await txRef.get();
    if (txSnap.exists) return res.status(200).send('Duplicate transaction - already credited');

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

    return res.send('✅ AdGem: Coins updated successfully');
  } catch (err) {
    console.error('AdGem postback error:', err);
    return res.status(500).send('Server error');
  }
});

// ✅ CPX Research Postback Endpoint
app.get('/cpx', async (req, res) => {
  const {
    status,
    trans_id,
    user_id,
    amount_local,
    amount_usd,
    hash,
  } = req.query;

  const CPX_SECRET = 'f3yNiOHf5oXpMCUpHpRr1kcGqQMpZVkk';

  if (status !== '1' || !user_id || !amount_local || !trans_id) {
    return res.status(400).send('Invalid or missing parameters');
  }

  const expectedHash = crypto
    .createHash('md5')
    .update(`${trans_id}-${CPX_SECRET}`)
    .digest('hex');

  if (hash !== expectedHash) return res.status(403).send('Invalid hash');

  try {
    const txRef = db.collection('cpx_tx').doc(trans_id);
    const txSnap = await txRef.get();
    if (txSnap.exists) return res.status(200).send('Duplicate transaction - already credited');

    const userRef = db.collection('users').doc(user_id);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).send('User not found');

    await db.runTransaction(async (t) => {
      t.set(txRef, {
        user_id,
        amount: parseInt(amount_local),
        createdAt: new Date(),
      });
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(parseInt(amount_local)),
      });
    });

    return res.send(`✅ CPX: Coins updated successfully`);
  } catch (err) {
    console.error('CPX postback error:', err);
    return res.status(500).send('Server error');
  }
});

// ✅ Start the Express server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
