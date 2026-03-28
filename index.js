// =======================================
// MPESA STK PUSH BACKEND (RENDER READY)
// =======================================

require("dotenv").config(); // ✅ LOAD ENV FIRST

const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ✅ Render dynamic port
const PORT = process.env.PORT || 3000;

// =======================================
// 🔍 DEBUG LOG
// =======================================
console.log("🚀 STARTING APP...");
console.log("ENV VARIABLES CHECK:", {
  CONSUMER_KEY: !!process.env.CONSUMER_KEY,
  CONSUMER_SECRET: !!process.env.CONSUMER_SECRET,
  SHORTCODE: !!process.env.SHORTCODE,
  PASSKEY: !!process.env.PASSKEY,
  CALLBACK_URL: !!process.env.CALLBACK_URL,
});

// =======================================
// 🔐 ENV VARIABLES
// =======================================
const consumerKey = process.env.CONSUMER_KEY;
const consumerSecret = process.env.CONSUMER_SECRET;
const shortcode = process.env.SHORTCODE;
const passkey = process.env.PASSKEY;
const callbackUrl = process.env.CALLBACK_URL;

// ✅ Strict validation (stop app if missing)
if (!consumerKey || !consumerSecret || !shortcode || !passkey || !callbackUrl) {
  console.error("❌ Missing environment variables! Check your .env file.");
  process.exit(1); // ⛔ stop app completely
}

// =======================================
// In-memory transactions store
// =======================================
const transactions = {};

// =======================================
// 🔧 Helper: Format phone number
// =======================================
function formatPhone(phone) {
  if (phone.startsWith("0")) {
    return "254" + phone.slice(1);
  }
  if (phone.startsWith("+")) {
    return phone.replace("+", "");
  }
  return phone;
}

// =======================================
// 1️⃣ Get Access Token
// =======================================
async function getAccessToken() {
  try {
    const url =
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

    const auth =
      "Basic " +
      Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

    const response = await axios.get(url, {
      headers: { Authorization: auth },
    });

    return response.data.access_token;
  } catch (error) {
    console.error("❌ TOKEN ERROR:", error.response?.data || error.message);
    throw new Error("Failed to get access token");
  }
}

// =======================================
// 2️⃣ STK PUSH
// =======================================
app.post("/stkpush", async (req, res) => {
  try {
    let { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({
        success: false,
        message: "Phone and amount required",
      });
    }

    phone = formatPhone(phone); // ✅ format number

    const token = await getAccessToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);

    const password = Buffer.from(
      shortcode + passkey + timestamp
    ).toString("base64");

    const stkData = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: `Order${Date.now()}`,
      TransactionDesc: "M-PESA Payment",
    };

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      stkData,
      {
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("📲 STK RESPONSE:", response.data);

    if (response.data.ResponseCode === "0") {
      const checkoutRequestId = response.data.CheckoutRequestID;

      transactions[checkoutRequestId] = {
        phone,
        amount,
        status: "Pending",
        createdAt: new Date(),
      };

      return res.json({
        success: true,
        message: "STK push sent",
        checkoutRequestId,
      });
    }

    return res.json({
      success: false,
      message: response.data.ResponseDescription,
    });
  } catch (error) {
    console.error("❌ STK ERROR:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      message: "STK Push failed",
      error: error.response?.data || error.message,
    });
  }
});

// =======================================
// 3️⃣ CALLBACK
// =======================================
app.post("/mpesa/callback", (req, res) => {
  try {
    console.log("📩 CALLBACK RECEIVED");

    const callback = req.body.Body?.stkCallback;

    if (!callback) {
      return res.status(400).json({ message: "Invalid callback" });
    }

    const checkoutRequestId = callback.CheckoutRequestID;
    const resultCode = String(callback.ResultCode);
    const resultDesc = callback.ResultDesc;

    if (transactions[checkoutRequestId]) {
      transactions[checkoutRequestId].status =
        resultCode === "0" ? "Completed" : "Failed";

      transactions[checkoutRequestId].resultDesc = resultDesc;

      if (resultCode === "0") {
        const metadata = callback.CallbackMetadata?.Item || [];

        const receipt = metadata.find(
          (item) => item.Name === "MpesaReceiptNumber"
        );

        if (receipt) {
          transactions[checkoutRequestId].receipt = receipt.Value;
        }
      }

      console.log("✅ UPDATED TRANSACTION:", transactions[checkoutRequestId]);
    } else {
      console.log("⚠️ Transaction not found for:", checkoutRequestId);
    }

    res.status(200).json({ message: "Callback processed" });
  } catch (error) {
    console.error("❌ CALLBACK ERROR:", error);
    res.status(500).json({ message: "Callback failed" });
  }
});

// =======================================
// 4️⃣ PAYMENT STATUS
// =======================================
app.get("/payment-status/:id", (req, res) => {
  const tx = transactions[req.params.id];

  if (!tx) {
    return res.status(404).json({
      success: false,
      message: "Transaction not found",
    });
  }

  res.json({
    success: true,
    ...tx,
  });
});

// =======================================
// 5️⃣ HEALTH CHECK
// =======================================
app.get("/", (req, res) => {
  res.send("MPESA Backend is running 🚀");
});

// =======================================
// START SERVER
// =======================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});