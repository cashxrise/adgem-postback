const express = require('express');
const admin = require('firebase-admin');
const app = express();

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY;
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

app.get('/adgem', async (req, res) => {
  const { user_id, amount, tx_id, auth } = req.query;

  if (auth !== SECRET_KEY) return res.status(403).send('Unauthorized');
  if (!user_id || !amount || !tx_id) return res.status(400).send('Missing parameters');

  try {
    const userRef = db.collection('users').doc(user_id);
    const userSnap = await userRef.get();

    if (!userSnap.exists) return res.status(404).send('User not found');

    await userRef.update({
      coins: admin.firestore.FieldValue.increment(Number(amount))
    });

    return res.send('Coins updated successfully');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
});

app.listen(PORT, () => {
  console.log('Server running on port ${PORT}');
});
