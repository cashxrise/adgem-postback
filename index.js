const express = require('express');  
const admin = require('firebase-admin');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const app = express();

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY;
const CPX_SECRET = process.env.CPX_SECRET;
const BITLABS_SECRET = process.env.BITLABS_SECRET;
const THEOREMREACH_SECRET = process.env.THEOREMREACH_SECRET;
const AYET_API_KEY = process.env.AYET_API_KEY;
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

// ✅ Shared BitLabs callback handler
const handleBitlabsCallback = async (req, res) => {
  try {
    const { uid, val, tx, raw, hash, debug } = req.query;

    if (!uid || !val || !tx || !raw || !hash)
      return res.status(400).send('❌ Missing required parameters');

    const baseUrl = `https://${req.get('host')}${req.path}`;
    const queryParams = new URLSearchParams({ uid, val, tx, raw });
    if (debug !== undefined) queryParams.append('debug', debug);
    const fullUrl = `${baseUrl}?${queryParams.toString()}`;

    const expectedHash = crypto
      .createHmac('sha1', BITLABS_SECRET)
      .update(fullUrl, 'utf8')
      .digest('hex');

    console.log('🔍 Full URL:', fullUrl);
    console.log('🔐 Expected Hash:', expectedHash);
    console.log('🧾 Received Hash:', hash);

    if (hash !== expectedHash)
      return res.status(403).send('Invalid signature');

    const txRef = db.collection('bitlabs_transactions').doc(tx);
    if ((await txRef.get()).exists)
      return res.status(200).send('Already rewarded');

    const userRef = db.collection('users').doc(uid);
    if (!(await userRef.get()).exists)
      return res.status(404).send('User not found');

    const rewardAmount = parseInt(val);

    await db.runTransaction(async (t) => {
      t.set(txRef, { uid, val: rewardAmount, raw, createdAt: new Date() });
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(rewardAmount),
      });
    });

    console.log(`✅ ${rewardAmount} coins rewarded to ${uid}`);
    return res.send('✅ BitLabs: Coins updated successfully');
  } catch (err) {
    console.error('BitLabs callback error:', err);
    return res.status(500).send('Server error');
  }
};

// ✅ BitLabs Callback Routes
app.get('/bitlabs-reward', handleBitlabsCallback);
app.get('/bitlabs-offer-reward', handleBitlabsCallback);

// ✅ AdGem Postback
app.get('/adgem', async (req, res) => {
  const { user_id, amount, tx_id, auth } = req.query;

  if (auth !== SECRET_KEY) return res.status(403).send('Unauthorized');
  if (!user_id || !amount || !tx_id)
    return res.status(400).send('Missing parameters');

  try {
    const txRef = db.collection('adgem_tx').doc(tx_id);
    if ((await txRef.get()).exists)
      return res.status(200).send('Duplicate transaction');

    const userRef = db.collection('users').doc(user_id);
    if (!(await userRef.get()).exists)
      return res.status(404).send('User not found');

    await db.runTransaction(async (t) => {
      t.set(txRef, { user_id, amount: parseInt(amount), createdAt: new Date() });
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(parseInt(amount)),
      });
    });

    return res.send('✅ AdGem: Coins updated');
  } catch (err) {
    console.error('AdGem error:', err);
    return res.status(500).send('Server error');
  }
});

// ✅ CPX Main
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
      return res.status(200).send('Duplicate transaction');

    const userRef = db.collection('users').doc(user_id);
    if (!(await userRef.get()).exists)
      return res.status(404).send('User not found');

    await db.runTransaction(async (t) => {
      t.set(txRef, { user_id, amount: parseInt(amount_local), createdAt: new Date() });
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(parseInt(amount_local)),
      });
    });

    return res.send('✅ CPX: Coins updated');
  } catch (err) {
    console.error('CPX error:', err);
    return res.status(500).send('Server error');
  }
});

// ✅ CPX Screenout
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
    if (!(await userRef.get()).exists)
      return res.status(404).send('User not found');

    await userRef.update({
      coins: admin.firestore.FieldValue.increment(parseInt(amount_local)),
    });

    return res.send('✅ CPX: Screenout bonus credited');
  } catch (err) {
    console.error('Screenout error:', err);
    return res.status(500).send('Server error');
  }
});

// ✅ CPX Bonus
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
    if (!(await userRef.get()).exists)
      return res.status(404).send('User not found');

    await userRef.update({
      coins: admin.firestore.FieldValue.increment(parseInt(amount_local)),
    });

    return res.send('✅ CPX: Bonus credited');
  } catch (err) {
    console.error('Bonus error:', err);
    return res.status(500).send('Server error');
  }
});

// ✅ TheoremReach Callback Handler
function generateTheoremReachHash(url, secret) {
  const raw = crypto.createHmac("sha1", secret).update(url, "utf8").digest();
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

app.get('/theoremreach/callback', async (req, res) => {
  try {
    const { user_id, reward, tx_id, hash } = req.query;

    if (!user_id || !reward || !tx_id || !hash) {
      return res.status(400).send("❌ Missing required parameters");
    }

    const baseUrl = `https://${req.get("host")}${req.path}`;
    const fullUrl =
      `${baseUrl}?` +
      Object.entries(req.query)
        .filter(([key]) => key !== "hash")
        .map(([key, val]) => `${key}=${val}`)
        .join("&");

    const expectedHash = generateTheoremReachHash(fullUrl, THEOREMREACH_SECRET);

    console.log("🔍 Full URL:", fullUrl);
    console.log("🔐 Expected Hash:", expectedHash);
    console.log("🧾 Received Hash:", hash);

    if (hash !== expectedHash) {
      return res.status(403).send("❌ Invalid signature");
    }

    const txRef = db.collection("theoremreach_transactions").doc(tx_id);
    if ((await txRef.get()).exists) {
      return res.status(200).send("Already rewarded");
    }

    const userRef = db.collection("users").doc(user_id);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return res.status(404).send("User not found");
    }

    const rewardAmount = parseInt(reward);
    if (isNaN(rewardAmount) || rewardAmount <= 0) {
      return res.status(400).send("❌ Invalid reward amount");
    }

    await db.runTransaction(async (t) => {
      t.set(txRef, {
        user_id,
        reward: rewardAmount,
        tx_id,
        createdAt: new Date(),
      });

      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(rewardAmount),
      });
    });

    console.log(`✅ ${rewardAmount} coins rewarded to ${user_id}`);
    return res.send("✅ TheoremReach: Coins updated successfully");
  } catch (err) {
    console.error("🔥 TheoremReach callback error:", err);
    return res.status(500).send("Server error");
  }
});

// ✅ Ayet Studios Callback Handler
app.get("/ayet/callback", async (req, res) => {
  try {
    const ayetHash = req.get("X-Ayetstudios-Security-Hash");

    if (!ayetHash) return res.status(403).send("❌ Missing HMAC header");

    // 🔁 URL-encode all values
    const encodedParams = {};
    Object.entries(req.query).forEach(([key, value]) => {
      encodedParams[key] = encodeURIComponent(value);
    });

    // 🔤 Sort keys alphabetically
    const sortedKeys = Object.keys(encodedParams).sort();
    const sortedQueryString = sortedKeys
      .map((key) => `${key}=${encodedParams[key]}`)
      .join("&");

    // 🔐 Generate HMAC-SHA256 hash
    const computedHash = crypto
      .createHmac("sha256", AYET_API_KEY)
      .update(sortedQueryString)
      .digest("hex");

    console.log("🔍 Sorted Query:", sortedQueryString);
    console.log("🧮 Computed Hash:", computedHash);
    console.log("📩 Received Hash:", ayetHash);

    if (computedHash !== ayetHash) {
      return res.status(403).send("❌ Invalid HMAC Signature");
    }

    // ✅ Extract parameters
    const { transaction_id, amount, user_id } = req.query;
    if (!transaction_id || !amount || !user_id) {
      return res.status(400).send("❌ Missing required parameters");
    }

    // ✅ Check if transaction already exists
    const txRef = db.collection("ayet_transactions").doc(transaction_id);
    if ((await txRef.get()).exists) {
      return res.status(200).send("⚠️ Duplicate transaction");
    }

    // ✅ Check if user exists
    const userRef = db.collection("users").doc(user_id);
    if (!(await userRef.get()).exists) {
      return res.status(404).send("❌ User not found");
    }

    // ✅ Reward user and store transaction
    await db.runTransaction(async (t) => {
      t.set(txRef, {
        transaction_id,
        user_id,
        amount: parseInt(amount),
        createdAt: new Date(),
      });
      t.update(userRef, {
        coins: admin.firestore.FieldValue.increment(parseInt(amount)),
      });
    });

    console.log(`✅ Ayet: ${amount} coins rewarded to ${user_id}`);
    return res.send("✅ Ayet: Coins rewarded");
  } catch (err) {
    console.error("🔥 Error handling Ayet callback:", err);
    return res.status(500).send("Server error");
  }
});

// ✅ Start the server
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
