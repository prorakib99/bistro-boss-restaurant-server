const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.fyh6bpe.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
    }
});

async function run() {
    try {
        client.connect();

        const foodCollection = client.db('bistroBossDB').collection('menu');
        const reviewCollection = client.db('bistroBossDB').collection('reviews');
        const cartCollection = client.db('bistroBossDB').collection('carts');

        app.get('/foods', async (req, res) => {
            let query = {};

            if (req.query.page) {
                const page = parseInt(req.query.page);
                const result = await foodCollection.find().limit(page).toArray();
                res.send(result);
            } else {
                const result = await foodCollection.find().toArray();
                res.send(result);
            }
        });

        app.get('/total', async (req, res) => {
            const result = await foodCollection.estimatedDocumentCount();
            res.send({ result });
        });

        app.get('/reviews', async (req, res) => {
            const result = await reviewCollection.find().toArray();
            res.send(result);
        });

        app.get('/category', async (req, res) => {
            const name = req.query.name;
            const page = parseInt(req.query.page);
            const limit = parseInt(req.query.limit);
            const query = { category: name };
            console.log(page);

            if (limit & page) {
                console.log('true');
                const result = await foodCollection
                    .find(query)
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .toArray();
                res.send(result);
            } else if (limit) {
                const result = await foodCollection.find(query).limit(limit).toArray();
                res.send(result);
            } else {
                const result = await foodCollection.find(query).toArray();
                res.send(result);
            }
        });

        app.get('/category/:name', async (req, res) => {
            const name = req.params.name;
            const query = { category: name };
            const result = await foodCollection.find(query).toArray();
            res.send({ total: result.length });
        });

        // Cart Items API
        app.get('/carts', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        });

        app.post('/carts', async (req, res) => {
            const cartItem = req.body;
            const result = await cartCollection.insertOne(cartItem);
            res.send(result);
        });

        await client.db('admin').command({ ping: 1 });
        console.log('Pinged your deployment. You successfully connected to MongoDB!');
    } finally {
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Booooss is running');
});

app.listen(port, () => {
    console.log(`Server running on port: ${port}`);
});
