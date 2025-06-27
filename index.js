const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');
const app = express();

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY;
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
const CPX_SECRET = 'f3yNiOHf5oXpMCUpHpRr1kcGqQMpZVkk';

// ✅ Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// ✅ Health check
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// ✅ AdGem Postback
app.get('/adgem', async (req, res) => {
  const { user_id, amount, tx_id, auth } = req.query;

  if (auth !== SECRET_KEY) return res.status(403).send('Unauthorized');
  if (!user_id || !amount || !tx_id) return res.status(400).send('Missing parameters');

  try {
    const txRef = db.collection('adgem_tx').doc(tx_id);
    if ((await txRef.get()).exists)
      return res.status(200).send('Duplicate transaction - already credited');

    const userRef = db.collection('users').doc(user_id);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');

    await db.runTransaction(async (t) => {
      t.set(txRef, { user_id, amount: parseInt(amount), createdAt: new Date() });
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(parseInt(amount)),
      });
    });

    return res.send('✅ AdGem: Coins updated successfully');
  } catch (err) {
    console.error('AdGem error:', err);
    return res.status(500).send('Server error');
  }
});

// ✅ CPX Complete Postback
app.get('/cpx', async (req, res) => {
  const { status, trans_id, user_id, amount_local, hash } = req.query;

  if (status !== '1' || !user_id || !amount_local || !trans_id || !hash)
    return res.status(400).send('Missing or invalid parameters');

  const expectedHash = crypto
    .createHash('md5')
    .update(`${trans_id}-${CPX_SECRET}`)
    .digest('hex');
  if (hash !== expectedHash) return res.status(403).send('Invalid hash');

  try {
    const txRef = db.collection('cpx_tx').doc(trans_id);
    if ((await txRef.get()).exists)
      return res.status(200).send('Duplicate transaction - already credited');

    const userRef = db.collection('users').doc(user_id);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');

    await db.runTransaction(async (t) => {
      t.set(txRef, { user_id, amount: parseInt(amount_local), createdAt: new Date() });
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(parseInt(amount_local)),
      });
    });

    return res.send(`✅ CPX: Coins updated successfully`);
  } catch (err) {
    console.error('CPX error:', err);
    return res.status(500).send('Server error');
  }
});

// ✅ CPX Screen Out Postback
app.get('/cpx-screenout', async (req, res) => {
  const { trans_id, user_id, amount_local, hash } = req.query;

  if (!user_id || !amount_local || !trans_id || !hash)
    return res.status(400).send('Missing parameters');

  const expectedHash = crypto
    .createHash('md5')
    .update(`${trans_id}-${CPX_SECRET}`)
    .digest('hex');
  if (hash !== expectedHash) return res.status(403).send('Invalid hash');

  try {
    const userRef = db.collection('users').doc(user_id);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');

    await userRef.update({
      coins: admin.firestore.FieldValue.increment(parseInt(amount_local)),
    });

    return res.send('✅ CPX: Screenout bonus credited');
  } catch (err) {
    console.error('Screenout error:', err);
    return res.status(500).send('Server error');
  }
});

// ✅ CPX Bonus/Rating Postback
app.get('/cpx-bonus', async (req, res) => {
  const { trans_id, user_id, amount_local, hash } = req.query;

  if (!user_id || !amount_local || !trans_id || !hash)
    return res.status(400).send('Missing parameters');

  const expectedHash = crypto
    .createHash('md5')
    .update(`${trans_id}-${CPX_SECRET}`)
    .digest('hex');
  if (hash !== expectedHash) return res.status(403).send('Invalid hash');

  try {
    const userRef = db.collection('users').doc(user_id);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');

    await userRef.update({
      coins: admin.firestore.FieldValue.increment(parseInt(amount_local)),
    });

    return res.send('✅ CPX: Bonus/Rating credited');
  } catch (err) {
    console.error('Bonus error:', err);
    return res.status(500).send('Server error');
  }
});

// ✅ CPX Canceled/Fraud Postback
app.get('/cpx-cancel', async (req, res) => {
  const { trans_id, hash } = req.query;

  if (!trans_id || !hash) return res.status(400).send('Missing parameters');

  const expectedHash = crypto
    .createHash('md5')
    .update(`${trans_id}-${CPX_SECRET}`)
    .digest('hex');
  if (hash !== expectedHash) return res.status(403).send('Invalid hash');

  console.warn(`❌ CPX: Fraudulent/canceled transaction detected: ${trans_id}`);
  return res.send('✅ CPX: Fraud/cancel callback logged');
});

// ✅ Start Express server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
