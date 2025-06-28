const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const app = express();

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY;
const CPX_SECRET = 'f3yNiOHf5oXpMCUpHpRr1kcGqQMpZVkk';
const BITLABS_SECRET = 'Hx5PVawUJo58jubMKt0vPvUnrh0F7cXZ';
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);

// ✅ Firebase Init
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

app.use(bodyParser.json());

// ✅ Health Check
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
    if ((await txRef.get()).exists) return res.send('Duplicate');

    const userRef = db.collection('users').doc(user_id);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');

    await db.runTransaction(async (t) => {
      t.set(txRef, { user_id, amount: parseInt(amount), createdAt: new Date() });
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(parseInt(amount)),
      });
    });

    res.send('✅ AdGem: Coins updated');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ✅ CPX Postback
app.get('/cpx', async (req, res) => {
  const { status, trans_id, user_id, amount_local, hash } = req.query;

  if (status !== '1') return res.status(200).send('Ignored');
  if (!user_id || !amount_local || !trans_id || !hash) return res.status(400).send('Missing');

  const expectedHash = crypto.createHash('md5').update(`${trans_id}-${CPX_SECRET}`).digest('hex');
  if (hash !== expectedHash) return res.status(403).send('Invalid hash');

  try {
    const txRef = db.collection('cpx_tx').doc(trans_id);
    if ((await txRef.get()).exists) return res.send('Duplicate');

    const userRef = db.collection('users').doc(user_id);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');

    await db.runTransaction(async (t) => {
      t.set(txRef, { user_id, amount: parseInt(amount_local), createdAt: new Date() });
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(parseInt(amount_local)),
      });
    });

    res.send('✅ CPX: Coins updated');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ✅ BitLabs GET Callback (reward via hash)
app.get('/bitlabs-reward', async (req, res) => {
  const { uid, val, tx, hash } = req.query;

  if (!uid || !val || !tx || !hash) return res.status(400).send('Missing');

  const expectedHash = crypto.createHash('sha256').update(uid + val + tx + BITLABS_SECRET).digest('hex');
  if (hash !== expectedHash) return res.status(403).send('Invalid hash');

  try {
    const txRef = db.collection('bitlabs_tx').doc(tx);
    if ((await txRef.get()).exists) return res.send('Duplicate');

    const userRef = db.collection('users').doc(uid);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');

    await db.runTransaction(async (t) => {
      t.set(txRef, { uid, val: parseInt(val), tx, createdAt: new Date() });
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(parseInt(val)),
      });
    });

    res.send('✅ BitLabs: GET reward credited');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ✅ BitLabs POST Reward via body + hash (no signature)
app.post('/bitlabs-reward', async (req, res) => {
  const { uid, val, tx, hash } = req.body;

  if (!uid || !val || !tx || !hash) return res.status(400).send('Missing');

  const expectedHash = crypto.createHash('sha256').update(uid + val + tx + BITLABS_SECRET).digest('hex');
  if (hash !== expectedHash) return res.status(403).send('Invalid hash');

  try {
    const txRef = db.collection('bitlabs_tx').doc(tx);
    if ((await txRef.get()).exists) return res.send('Duplicate');

    const userRef = db.collection('users').doc(uid);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');

    await db.runTransaction(async (t) => {
      t.set(txRef, { uid, val: parseInt(val), tx, createdAt: new Date() });
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(parseInt(val)),
      });
    });

    res.send('✅ BitLabs: POST reward credited');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ✅ BitLabs Offer Callback (if separate)
app.post('/bitlabs-offer', async (req, res) => {
  const { uid, val, tx, hash } = req.body;

  if (!uid || !val || !tx || !hash) return res.status(400).send('Missing');

  const expectedHash = crypto.createHash('sha256').update(uid + val + tx + BITLABS_SECRET).digest('hex');
  if (hash !== expectedHash) return res.status(403).send('Invalid hash');

  try {
    const txRef = db.collection('bitlabs_tx').doc(tx);
    if ((await txRef.get()).exists) return res.send('Duplicate');

    const userRef = db.collection('users').doc(uid);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');

    await db.runTransaction(async (t) => {
      t.set(txRef, { uid, val: parseInt(val), tx, type: 'offer', createdAt: new Date() });
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(parseInt(val)),
      });
    });

    res.send('✅ BitLabs: POST offer credited');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
