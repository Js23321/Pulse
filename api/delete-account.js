const admin = require("firebase-admin");

// Initialise Firebase Admin once per cold start
if (!admin.apps.length) {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  } catch {
    serviceAccount = {};
  }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body =
    typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const { idToken } = body;

  if (!idToken || typeof idToken !== "string") {
    return res.status(400).json({ error: "idToken is required" });
  }

  try {
    // Verify the caller's identity
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    // Delete Firestore data
    const db = admin.firestore();
    await db.collection("pulseUsers").doc(uid).delete();

    // Delete the Firebase Auth account
    await admin.auth().deleteUser(uid);

    return res.status(200).json({ deleted: true });
  } catch (error) {
    console.error("delete-account error:", error);
    return res.status(500).json({ error: error?.message || String(error) });
  }
};
