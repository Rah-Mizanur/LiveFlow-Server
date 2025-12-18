require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;

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
      "https://b12-m11-session.web.app",
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
    //    app.patch("/profile", verifyJWT, async (req, res) => {
    //   const { email,district,upazila,bloodGroup,image  } = req.body;
    //   const result = await usersCollection.updateOne(
    //     { email },
    //     { $set: { district } },
    //     { $set: { upazila } },
    //     { $set: { bloodGroup } },
    //     { $set: { image } },

    //   );

    //   res.send(result);
    // });
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
    app.get("/all-blood-req", verifyJWT, async (req, res) => {
      const result = await bloodRequestsCollection
        .find()
        .toArray();
      res.send(result);
    });
    app.get("/all-users", verifyJWT, async (req, res) => {
      const result = await usersCollection
        .find()
        .toArray();
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
      const user = await usersCollection.findOne({email})
      const updateStatus = user.status === 'active' ? 'block': 'active'
      const result = await usersCollection.updateOne(
        { email },
        { $set: {status : updateStatus } }
      );
      res.send(result);
    });

    // update blood request status 
      app.patch("/update-blood-status", verifyJWT, async (req, res) => {
      const { id, status , donorName,donorEmail } = req.body;
    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: { 
        status: status,
        donorName: donorName,
        donorEmail: donorEmail  
      },
    };
    const result = await bloodRequestsCollection.updateOne(filter, updateDoc);
    res.send(result);
    });
    

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
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
