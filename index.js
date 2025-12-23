require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.Stripe_Key);
const decoded = Buffer.from(process.env.Fb_Key, "base64").toString("utf-8");
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://liveflow-9ebbf.web.app",
    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const db = client.db("Liveflow");
    const usersCollection = db.collection("users");
    const bloodRequestsCollection = db.collection("bloodRequests");
    const deletedBloodRequestsCollection = db.collection("deletedRequest");
    const donationsCollection = db.collection("donation");
    // save user information when they signup
    app.post("/user", async (req, res) => {
      const userData = req.body;
      userData.role = "donor";
      userData.status = "active";
      userData.created_at = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      const query = { email: userData.email };
      const alreadyExists = await usersCollection.findOne(query);
      console.log("user already exist--->", !!alreadyExists);
      if (alreadyExists) {
        console.log("updating info ....");
        const result = await usersCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        });
        return res.send(result);
      }

      const result = await usersCollection.insertOne(userData);
      return res.send(result);
    });

    app.get("/profile", verifyJWT, async (req, res) => {
      const result = await usersCollection.findOne({ email: req.tokenEmail });
      res.send(result);
    });
    app.post("/create-request", verifyJWT, async (req, res) => {
      const bloodRequests = req.body;
      bloodRequests.requestTime = new Date();
      bloodRequests.status = "pending";
      const result = bloodRequestsCollection.insertOne(bloodRequests);
      res.send(result);
    });
    app.get("/my-blood-req-latest/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const result = await bloodRequestsCollection
        .find({ registererEmail: email })
        .sort({ requestTime: -1 })
        .limit(3)
        .toArray();
      res.send(result);
    });
    app.get("/my-blood-req/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const result = await bloodRequestsCollection
        .find({ registererEmail: email })
        .toArray();
      res.send(result);
    });

    app.get("/pending-blood-req", async (req, res) => {
      const filter = { status: "pending" };
      const result = await bloodRequestsCollection.find(filter).toArray();
      res.send(result);
    });
    // funding data 
    app.get("/funding", async (req, res) => {
      const result = await donationsCollection.find().toArray();
      res.send(result);
    });
    app.get("/deleted-blood-req", verifyJWT, async (req, res) => {
      const result = await deletedBloodRequestsCollection.find().toArray();
      res.send(result);
    });
    app.get("/all-blood-req", async (req, res) => {
      let { bloodGroup, status } = req.query;
      let query = {};

      if (bloodGroup && bloodGroup.trim() !== "") {
        const sanitizedBloodGroup = bloodGroup.trim();
        query.bloodGroup = sanitizedBloodGroup;
      }

      if (status && status.trim() !== "") {
        query.status = status.trim();
      }

      try {
        const result = await bloodRequestsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching requests" });
      }
    });
    app.get("/all-users", verifyJWT, async (req, res) => {
      const { status } = req.query;

      let query = {};
      if (status && status !== "") {
        query.status = status;
      }

      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });
    app.get("/req-details/:id", async (req, res) => {
      const { id } = req.params;
      const result = await bloodRequestsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.get("/user/role", verifyJWT, async (req, res) => {
      const result = await usersCollection.findOne({ email: req.tokenEmail });
      res.send({ role: result?.role });
    });
    app.get("/user/status", verifyJWT, async (req, res) => {
      const result = await usersCollection.findOne({ email: req.tokenEmail });
      res.send({ status: result?.status });
    });

    // users role update api
    app.patch("/update-role", verifyJWT, async (req, res) => {
      const { email, role } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { role } }
      );
      res.send(result);
    });
    app.patch("/update-status", verifyJWT, async (req, res) => {
      const { email } = req.body;
      const user = await usersCollection.findOne({ email });
      const updateStatus = user.status === "active" ? "block" : "active";
      const result = await usersCollection.updateOne(
        { email },
        { $set: { status: updateStatus } }
      );
      res.send(result);
    });

    // update blood request status
    app.patch("/update-blood-status", verifyJWT, async (req, res) => {
      const { id, status, donorName, donorEmail } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: status,
          donorName: donorName,
          donorEmail: donorEmail,
        },
      };
      const result = await bloodRequestsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.patch("/update-blood-status-done", verifyJWT, async (req, res) => {
      const { id, status } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: status,
        },
      };
      const result = await bloodRequestsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });
    // edit post
    app.patch("/edit-request", verifyJWT, async (req, res) => {
      const { id, updateRequest } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          ...updateRequest,
          edit_At: new Date(),
        },
      };
      const result = await bloodRequestsCollection.updateOne(filter, updateDoc);
      console.log(result);
      res.send(result);
    });

    app.patch("/profile-update", verifyJWT, async (req, res) => {
      const { email, updatedProfile } = req.body;
      const filter = { email: email };
      const updateDoc = {
        $set: {
          ...updatedProfile,
          last_update_At: new Date(),
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      console.log(result);
      res.send(result);
    });

    // delete data and includes other database
    app.post("/delete-request", verifyJWT, async (req, res) => {
      const { id, request } = req.body;
      const archiveData = { ...request };
      delete archiveData._id;
      archiveData.originalId = id;
      archiveData.deletedAt = new Date();

      const result = await deletedBloodRequestsCollection.insertOne(request);
      await bloodRequestsCollection.deleteOne({ _id: new ObjectId(id) });
      console.log(result);
      res.send(result);
    });

    // apply search api

    app.get("/searchdata", async (req, res) => {
      try {
        const { bloodGroup, district, upazila } = req.query;
        let query = {};

        if (bloodGroup && bloodGroup !== "") {
          query.bloodGroup = bloodGroup;
        }

        // IMPORTANT: Use the exact keys from your database (recipientZila / recipientUpazila)
        if (district && district !== "") {
          query.zila = district;
        }

        if (upazila && upazila !== "") {
          query.upazila = upazila;
        }

        // console.log("Final MongoDB Query:", query); // Check your terminal to see if this looks right

        const result = await usersCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error("Search Error:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // stripe add
    app.post("/create-checkout-session", async (req, res) => {
      const donationInfo = req.body;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "Donation",
              },
              unit_amount: donationInfo.amount * 100,
            },
            quantity: 1,
          },
        ],

        mode: "payment",

        customer_email: donationInfo.donorEmail,

        metadata: {
          donor: donationInfo.donor,
        },

        success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/funding`,
      });

      res.send({ url: session.url });
    });

    app.post("/payment-success", async (req, res) => {
      try {
        const { sessionId } = req.body;

        if (!sessionId) {
          return res.status(400).send({ error: "Session ID required" });
        }

        // Retrieve Stripe session
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // Check if already saved
        const existingDonation = await donationsCollection.findOne({
          transactionId: session.payment_intent,
        });

        // Ensure payment completed and not duplicated
        if (session.status === "complete" && !existingDonation) {
          const donationInfo = {
            donor: session.metadata?.donor || "Anonymous",
            donorEmail: session.customer_email,
            amount: session.amount_total / 100,
            transactionId: session.payment_intent,
            paymentStatus: session.payment_status,
            donateAt: new Date(),
          };

          const result = await donationsCollection.insertOne(donationInfo);

          return res.send({
            success: true,
            donationId: result.insertedId,
            transactionId: session.payment_intent,
          });
        }

        // If already exists
        res.send({
          success: true,
          transactionId: session.payment_intent,
          message: "Donation already recorded",
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Payment verification failed" });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
