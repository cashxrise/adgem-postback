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

// ✅ Parse JSON body
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
    if ((await txRef.get()).exists) return res.status(200).send('Duplicate transaction - already credited');

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

// ✅ CPX Postbacks
app.get('/cpx', async (req, res) => {
  const { status, trans_id, user_id, amount_local, hash } = req.query;

  if (status !== '1' || !user_id || !amount_local || !trans_id || !hash)
    return res.status(400).send('Missing or invalid parameters');

  const expectedHash = crypto.createHash('md5').update(`${trans_id}-${CPX_SECRET}`).digest('hex');
  if (hash !== expectedHash) return res.status(403).send('Invalid hash');

  try {
    const txRef = db.collection('cpx_tx').doc(trans_id);
    if ((await txRef.get()).exists) return res.status(200).send('Duplicate transaction - already credited');

    const userRef = db.collection('users').doc(user_id);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');

    await db.runTransaction(async (t) => {
      t.set(txRef, { user_id, amount: parseInt(amount_local), createdAt: new Date() });
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(parseInt(amount_local)),
      });
    });

    return res.send('✅ CPX: Coins updated successfully');
  } catch (err) {
    console.error('CPX error:', err);
    return res.status(500).send('Server error');
  }
});

app.get('/cpx-screenout', async (req, res) => {
  const { trans_id, user_id, amount_local, hash } = req.query;

  if (!user_id || !amount_local || !trans_id || !hash)
    return res.status(400).send('Missing parameters');

  const expectedHash = crypto.createHash('md5').update(`${trans_id}-${CPX_SECRET}`).digest('hex');
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

app.get('/cpx-bonus', async (req, res) => {
  const { trans_id, user_id, amount_local, hash } = req.query;

  if (!user_id || !amount_local || !trans_id || !hash)
    return res.status(400).send('Missing parameters');

  const expectedHash = crypto.createHash('md5').update(`${trans_id}-${CPX_SECRET}`).digest('hex');
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

// ✅ BitLabs GET with HMAC-SHA1 hash check
app.get('/bitlabs-reward', async (req, res) => {
  const fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;

  const [urlWithoutHash, receivedHash] = fullUrl.split('&hash=');
  if (!urlWithoutHash || !receivedHash) return res.status(400).send('Missing hash');

  // ✅ Create SHA1 HMAC of full URL before &hash=
  const hmac = crypto.createHmac('sha1', BITLABS_SECRET);
  hmac.update(urlWithoutHash); // DON'T decode or change URL
  const expectedHash = hmac.digest('hex');

  if (receivedHash !== expectedHash) {
    console.log('❌ Hash mismatch');
    console.log('Expected:', expectedHash);
    console.log('Received:', receivedHash);
    return res.status(403).send('Invalid hash');
  }

  // ✅ Continue to credit user
  const { uid, val, tx } = req.query;
  if (!uid || !val || !tx) return res.status(400).send('Missing parameters');

  try {
    const txRef = db.collection('bitlabs_tx').doc(tx);
    if ((await txRef.get()).exists) return res.send('Duplicate');

    const userRef = db.collection('users').doc(uid);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');

    await db.runTransaction(t => {
      t.set(txRef, { uid, val: parseInt(val), tx, type: 'survey', createdAt: new Date() });
      t.update(userRef, { coins: admin.firestore.FieldValue.increment(parseInt(val)) });
    });

    res.send('✅ BitLabs: GET reward credited');
  } catch (err) {
    console.error('BitLabs GET error:', err);
    res.status(500).send('Server error');
  }
});

// ✅ BitLabs POST (reward & offer)
const validatePostHash = ({ uid, val, tx, hash }) => {
  const urlString = `uid=${uid}&val=${val}&tx=${tx}`;
  const hmac = crypto.createHmac('sha1', BITLABS_SECRET);
  hmac.update(urlString);
  const expectedHash = hmac.digest('hex');
  return hash === expectedHash;
};

app.post('/bitlabs-reward', async (req, res) => {
  const { uid, val, tx, hash } = req.body;
  if (!uid || !val || !tx || !hash) return res.status(400).send('Missing');
  if (!validatePostHash(req.body)) return res.status(403).send('Invalid hash');
  try {
    const txRef = db.collection('bitlabs_tx').doc(tx);
    if ((await txRef.get()).exists) return res.send('Duplicate');
    const userRef = db.collection('users').doc(uid);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');
    await db.runTransaction(t => {
      t.set(txRef, { uid, val: parseInt(val), tx, type: 'survey', createdAt: new Date() });
      t.update(userRef, { coins: admin.firestore.FieldValue.increment(parseInt(val)) });
    });
    res.send('✅ BitLabs: POST reward credited');
  } catch (err) {
    console.error('BitLabs POST error:', err);
    res.status(500).send('Server error');
  }
});

app.get('/bitlabs-offer', async (req, res) => {
  const fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
  const [urlWithoutHash, receivedHash] = fullUrl.split('&hash=');
  if (!urlWithoutHash || !receivedHash) return res.status(400).send('Missing hash');

  const hmac = crypto.createHmac('sha1', BITLABS_SECRET);
  hmac.update(urlWithoutHash);
  const expectedHash = hmac.digest('hex');

  if (receivedHash !== expectedHash) {
    console.log('❌ BitLabs OFFER hash mismatch');
    return res.status(403).send('Invalid hash');
  }

  const { uid, val, tx } = req.query;
  if (!uid || !val || !tx) return res.status(400).send('Missing parameters');

  try {
    const txRef = db.collection('bitlabs_tx').doc(tx);
    if ((await txRef.get()).exists) return res.send('Duplicate');

    const userRef = db.collection('users').doc(uid);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');

    await db.runTransaction(t => {
      t.set(txRef, { uid, val: parseInt(val), tx, type: 'offer', createdAt: new Date() });
      t.update(userRef, { coins: admin.firestore.FieldValue.increment(parseInt(val)) });
    });

    res.send('✅ BitLabs: GET offer credited');
  } catch (err) {
    console.error('BitLabs GET Offer error:', err);
    res.status(500).send('Server error');
  }
});

app.post('/bitlabs-offer', async (req, res) => {
  const { uid, val, tx, hash } = req.body;
  if (!uid || !val || !tx || !hash) return res.status(400).send('Missing');
  if (!validatePostHash(req.body)) return res.status(403).send('Invalid hash');
  try {
    const txRef = db.collection('bitlabs_tx').doc(tx);
    if ((await txRef.get()).exists) return res.send('Duplicate');
    const userRef = db.collection('users').doc(uid);
    if (!(await userRef.get()).exists) return res.status(404).send('User not found');
    await db.runTransaction(t => {
      t.set(txRef, { uid, val: parseInt(val), tx, type: 'offer', createdAt: new Date() });
      t.update(userRef, { coins: admin.firestore.FieldValue.increment(parseInt(val)) });
    });
    res.send('✅ BitLabs: Offer reward credited');
  } catch (err) {
    console.error('BitLabs Offer error:', err);
    res.status(500).send('Server error');
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

