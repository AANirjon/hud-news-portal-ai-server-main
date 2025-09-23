
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const axios = require("axios");
const { ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ubxkj0o.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

const verifyToken = (req, res, next) => {
  if (!req.headers.authorization) return res.status(401).send({ message: "Unauthorized" });
  const token = req.headers.authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) return res.status(401).send({ message: "Unauthorized" });
    req.decoded = decoded;
    next();
  });
};

const computeScore = (newsItem, userTags = []) => {
  let score = newsItem.popularity || 0;
  if (newsItem.tags && userTags.length) {
    const match = newsItem.tags.filter(tag => userTags.includes(tag)).length;
    score += match * 10;
  }
  const hoursSince = (Date.now() - new Date(newsItem.timestamp).getTime()) / 1000 / 3600;
  score += Math.max(0, 50 - hoursSince);
  return score;
};

async function run() {
  try {
    // await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db("hudnewsfeed_db");
    const usersCollection = db.collection("users");
    const newsCollection = db.collection("news");
    const bookmarksCollection = db.collection("bookmarks");
    const settingsCollection = db.collection("settings");

    // ---------------- Users & JWT ----------------
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
      res.send({ token });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const existing = await usersCollection.findOne({ email: user.email });
      if (existing) return res.send({ message: "User already exists" });
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // ---------------- News ----------------
    app.get("/news", verifyToken, async (req, res) => {
      try {
        const userEmail = req.query.email;
        const userSettings = await settingsCollection.findOne({ email: userEmail });
        const userTags = userSettings?.tags || [];

        // Fetch news from DB
        const dbNews = await newsCollection.find().toArray();

        // Fetch HackerNews
        const hnResponse = await axios.get("https://hacker-news.firebaseio.com/v0/topstories.json");
        const topIds = hnResponse.data.slice(0, 10);
        const hnNews = [];
        for (const id of topIds) {
          const item = await axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          hnNews.push({
            title: item.data.title,
            url: item.data.url,
            source: "HackerNews",
            timestamp: new Date(item.data.time * 1000),
            tags: ["tech"],
            popularity: item.data.score
          });
        }

        // Fetch Reddit posts
        // const redditSubreddits = ["technology", "MachineLearning"]; // example
        // let redditNews = [];
        // for (const subreddit of redditSubreddits) {
        //   const resp = await axios.get(`https://www.reddit.com/r/${subreddit}/hot.json?limit=5`);
        //   redditNews = redditNews.concat(
        //     resp.data.data.children.map(post => ({
        //       title: post.data.title,
        //       url: `https://reddit.com${post.data.permalink}`,
        //       source: `r/${subreddit}`,
        //       timestamp: new Date(post.data.created_utc * 1000),
        //       tags: ["reddit", subreddit.toLowerCase()],
        //       popularity: post.data.ups
        //     }))
        //   );
        // }

        // Fetch X posts (Twitter API v2)

        // const xAccounts = ["elonmusk", "OpenAI"]; // example
        // let xNews = [];
        // for (const username of xAccounts) {
        //   // This requires your X_BEARER_TOKEN in .env
        //   try {
        //     const resp = await axios.get(
        //       `https://api.twitter.com/2/users/by/username/${username}`,
        //       { headers: { Authorization: `Bearer ${!process.env.X_BEARER_TOKEN}` } }
        //     );
        //     const userId = resp.data.data.id;
        //     const tweetsResp = await axios.get(
        //       `https://api.twitter.com/2/users/${userId}/tweets?max_results=5&tweet.fields=created_at,public_metrics`,
        //       { headers: { Authorization: `Bearer ${!process.env.X_BEARER_TOKEN}` } }
        //     );
        //     xNews = xNews.concat(
        //       tweetsResp.data.data.map(tweet => ({
        //         title: tweet.text,
        //         url: `https://twitter.com/${username}/status/${tweet.id}`,
        //         source: `X/${username}`,
        //         timestamp: new Date(tweet.created_at),
        //         tags: ["x", username.toLowerCase()],
        //         popularity: tweet.public_metrics?.like_count || 0
        //       }))
        //     );
        //   } catch (err) {
        //     console.error(`Failed to fetch X/${username}:`, err.message);
        //   }
        // }


        // const newsletterNews = [];

        // Merge all sources
        let allNews = [...dbNews, ...hnNews];
        // let allNews = [...dbNews, ...hnNews, ...redditNews, ...xNews, ...newsletterNews];

        // Compute ranking
        allNews = allNews.map(item => ({ ...item, rankScore: computeScore(item, userTags) }));
        allNews.sort((a, b) => b.rankScore - a.rankScore);

        res.send(allNews);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch news" });
      }
    });

    app.post("/news", verifyToken, async (req, res) => {
      const newsItem = {
        ...req.body,
        timestamp: new Date(),
        source: req.body.source || "unknown",
        tags: req.body.tags || [],
        popularity: req.body.popularity || 0
      };
      const result = await newsCollection.insertOne(newsItem);
      res.send(result);
    });

    // ---------------- Bookmarks ----------------
    app.get("/bookmarks", verifyToken, async (req, res) => {
      const email = req.query.email;
      const result = await bookmarksCollection.find({ email }).sort({ createdAt: -1 }).toArray();
      res.send(result);
    });

    app.post("/bookmarks", verifyToken, async (req, res) => {
      const bookmark = { ...req.body, createdAt: new Date() };
      const result = await bookmarksCollection.insertOne(bookmark);
      res.send(result);
    });

    app.delete("/bookmarks/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await bookmarksCollection.deleteOne({
          _id: new ObjectId(id),
          userEmail: req.user?.email,
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Bookmark not found" });
        }

        res.send({ message: "Bookmark deleted successfully", id });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ---------------- Settings Routes ----------------
    app.get("/settings/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      try {
        const result = await settingsCollection.findOne({ email });
        res.send(result || { email, topics: [], tags: [] });
      } catch (error) {
        console.error("Error fetching settings:", error);
        res.status(500).send({ error: "Failed to fetch settings" });
      }
    });

    app.post("/settings", verifyToken, async (req, res) => {
      const { email, topics, tags } = req.body;
      try {
        const result = await settingsCollection.updateOne(
          { email },
          { $set: { topics: topics || [], tags: tags || [] } },
          { upsert: true }
        );
        res.send({ success: true, result });
      } catch (error) {
        console.error("Error saving settings:", error);
        res.status(500).send({ error: "Failed to save settings" });
      }
    });


    // ---------------- Payments  Stripe----------------
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // ---------------- Root ----------------
    app.get("/", (req, res) => {
      res.send("HUD NewsFeed Backend Running...");
    });

  } finally {
    // keep Mongo client open
  }
}

run().catch(console.dir);
app.listen(port, () => console.log(`Server running on port ${port}`));
