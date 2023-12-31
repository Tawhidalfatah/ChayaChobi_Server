// Required packages
const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// JWT token verify middleware
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "Unauthorized Access" });
  }
  // bearer token from the client side
  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "Unauthorized Access" });
    }
    req.decoded = decoded;
    next();
  });
};

// Mongodb uri
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.4xnjt3a.mongodb.net/?retryWrites=true&w=majority`;

// Mongodb client connection
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    // Mongodb collections
    const classesCollection = client.db("chayachobi").collection("classes");
    const usersCollection = client.db("chayachobi").collection("users");
    const selectedCollection = client
      .db("chayachobi")
      .collection("selectedClasses");
    const enrolledCollection = client
      .db("chayachobi")
      .collection("enrolledClasses");

    // Payment intent for stripe
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { price } = req.body;

      if (price) {
        const amount = parseFloat(price) * 100;
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      }
    });

    // jwt token generator
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "7d",
      });

      res.send({ token });
    });

    // Admin role verify middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ error: true, message: "Forbidden access" });
      }
      next();
    };

    // Instructor role verify middleware
    const verifyInstructor = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "instructor") {
        return res
          .status(403)
          .send({ error: true, message: "Forbidden access" });
      }
      next();
    };

    // all users get api for admin
    app.get("/allusers", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // all instructors get api for users
    app.get("/allinstructors", async (req, res) => {
      const result = await usersCollection
        .find({ role: "instructor" })
        .toArray();
      res.send(result);
    });

    // post api for user information after registration/login
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "User already exists" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/student/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        res.send({ student: false });
      }
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { student: user?.role === "student" };
      res.send(result);
    });

    app.get("/users/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        res.send({ admin: false });
      }
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });

    app.get(
      "/users/instructor/:email",
      verifyJWT,
      verifyInstructor,
      async (req, res) => {
        const email = req.params.email;
        if (req.decoded.email !== email) {
          res.send({ instructor: false });
        }
        const query = { email: email };
        const user = await usersCollection.findOne(query);
        const result = { instructor: user?.role === "instructor" };
        res.send(result);
      }
    );

    app.patch(
      "/user/admin/:email",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const query = { email: email };
        const updateDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await usersCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );
    app.patch(
      "/user/instructor/:email",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const query = { email: email };
        const updateDoc = {
          $set: {
            role: "instructor",
          },
        };
        const result = await usersCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );

    app.get("/allclasses", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await classesCollection.find().toArray();
      res.send(result);
    });

    app.get("/approvedclasses", async (req, res) => {
      const result = await classesCollection
        .find({ status: "approved" })
        .toArray();
      res.send(result);
    });

    app.get("/popularclasses", async (req, res) => {
      const result = await classesCollection
        .find({ status: "approved" })
        .sort({ enrolled_students_quantity: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    app.get("/popularinstructors", async (req, res) => {
      // TODO sort by popular with enrolled students quantity
      const result = await usersCollection
        .find({ role: "instructor" })
        .limit(6)
        .toArray();
      res.send(result);
    });

    app.get("/selectedclasses/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const query = { student_email: email };
      const result = await selectedCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/enrolledclasses/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const query = { student_email: email };
      const result = await enrolledCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/payhistory/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const query = { student_email: email };
      const result = await enrolledCollection
        .find(query)
        .sort({ date: -1 })
        .toArray();
      res.send(result);
    });

    app.post("/enrolledclasses", verifyJWT, async (req, res) => {
      const enrolledClass = req.body;
      const { class_id } = enrolledClass;
      const result = await enrolledCollection.insertOne(enrolledClass);

      const updatedClassResult = await classesCollection.updateOne(
        { _id: new ObjectId(class_id) },
        {
          $inc: {
            available_seats: -1,
            enrolled_students_quantity: 1,
          },
        }
      );
      res.send(result);
    });

    app.delete("/selectedclass/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };
      const result = await selectedCollection.deleteOne(query);

      res.send(result);
    });

    app.post("/selectedclasses", verifyJWT, async (req, res) => {
      const selectedClass = req.body;
      const result = await selectedCollection.insertOne(selectedClass);
      res.send(result);
    });

    app.get(
      "/myclasses/:email",
      verifyJWT,
      verifyInstructor,
      async (req, res) => {
        const email = req.params.email;

        const query = { instructor_email: email };
        const result = await classesCollection.find(query).toArray();

        res.send(result);
      }
    );

    app.post("/addclass", verifyJWT, verifyInstructor, async (req, res) => {
      const newClass = req.body;
      const result = await classesCollection.insertOne(newClass);
      res.send(result);
    });

    app.patch(
      "/class/approve/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: "approved",
          },
        };
        const result = await classesCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );

    app.patch("/class/deny/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: "denied",
        },
      };
      const result = await classesCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.patch(
      "/classes/feedback/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { feedback } = req.body;

        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            feedback: feedback,
          },
        };
        const result = await classesCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Summer Camp Server is running");
});

app.listen(port, () => {
  console.log(`Summer Camp on port ${port}`);
});
