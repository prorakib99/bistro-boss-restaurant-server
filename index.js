const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_TOKEN);
const jwt = require('jsonwebtoken');
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

        const databaseName = client.db('bistroBossDB');
        const menuCollection = databaseName.collection('menu');
        const usersCollection = databaseName.collection('users');
        const reviewCollection = databaseName.collection('reviews');
        const cartCollection = databaseName.collection('carts');
        const paymentCollection = databaseName.collection('payments');

        // JWT APIs
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        });

        // Verify User Token
        const verifyJWT = (req, res, next) => {
            const authorization = req.headers.authorization;
            if (!authorization) {
                return res.status(401).send({ error: 'unauthorized access' });
            }

            const token = authorization.split(' ')[1];

            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ error: true, message: 'unauthorized access' });
                }
                req.decoded = decoded;
                next();
            });
        };

        // VerifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden message' });
            }
            next();
        };

        // Admin Related APIs
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                return res.send({ admin: false });
            }

            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const result = { admin: user?.role === 'admin' };
            res.send(result);
        });

        app.get('/admin-stats', verifyJWT, verifyAdmin, async (req, res) => {
            const revenue = (await paymentCollection.find().toArray()).reduce(
                (sum, item) => sum + item.price,
                0
            );
            const users = (await usersCollection.find().toArray()).filter(
                (user) => user.role !== 'admin'
            ).length;
            const products = await menuCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();

            res.send({ revenue, users, products, orders });
        });

        app.get('/order-stats', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await paymentCollection
                .aggregate([
                    {
                        $unwind: '$menuItems'
                    },
                    {
                        $lookup: {
                            from: 'menu',
                            let: { menuItemId: { $toObjectId: '$menuItems' } },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: {
                                            $eq: ['$_id', '$$menuItemId']
                                        }
                                    }
                                }
                            ],
                            as: 'menuItemsData'
                        }
                    },
                    {
                        $unwind: '$menuItemsData'
                    },
                    {
                        $group: {
                            _id: '$menuItemsData.category',
                            quantity: { $sum: 1 },
                            revenue: { $sum: '$menuItemsData.price' }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            category: {
                                $concat: [
                                    { $toUpper: { $substrCP: ['$_id', 0, 1] } },
                                    {
                                        $substrCP: [
                                            '$_id',
                                            1,
                                            { $subtract: [{ $strLenCP: '$_id' }, 1] }
                                        ]
                                    }
                                ]
                            },
                            quantity: '$quantity',
                            total: '$revenue'
                        }
                    }
                ])
                .toArray();
            res.send(result);
        });

        // User Related APIs
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        app.post('/users', async (req, res) => {
            const user = req.body;
            const filter = { email: user.email };
            const exitingUser = await usersCollection.findOne(filter);
            if (exitingUser) {
                return res.send({ message: 'User have already exist' });
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.delete('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(query);
            res.send(result);
        });

        // Menu Related APIs
        app.get('/foods', async (req, res) => {
            let query = {};

            if (req.query.page) {
                const page = parseInt(req.query.page);
                const result = await menuCollection.find().limit(page).toArray();
                res.send(result);
            } else {
                const result = await menuCollection.find().toArray();
                res.send(result);
            }
        });

        app.get('/foods/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.findOne(query);
            res.send(result);
        });

        app.post('/foods', verifyJWT, verifyAdmin, async (req, res) => {
            const newFood = req.body;
            const result = await menuCollection.insertOne(newFood);
            res.send(result);
        });

        app.put('/updateFoods/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { name, category, price, recipe } = req.body;
            const filter = { _id: new ObjectId(id) };
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    name,
                    category,
                    price: parseFloat(price),
                    recipe
                }
            };
            const result = await menuCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        });

        app.delete('/foods/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await menuCollection.deleteOne(query);
            res.send(result);
        });

        app.get('/total', async (req, res) => {
            const result = await menuCollection.estimatedDocumentCount();
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

            if (limit & page) {
                const result = await menuCollection
                    .find(query)
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .toArray();
                res.send(result);
            } else if (limit) {
                const result = await menuCollection.find(query).limit(limit).toArray();
                res.send(result);
            } else {
                const result = await menuCollection.find(query).toArray();
                res.send(result);
            }
        });

        app.get('/category/:name', async (req, res) => {
            const name = req.params.name;
            const query = { category: name };
            const result = await menuCollection.find(query).toArray();
            res.send({ total: result.length });
        });

        // Cart Items API
        app.get('/carts', verifyJWT, async (req, res) => {
            const email = req.query.email;

            if (!email) {
                return res.send([]);
            }

            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            }

            const query = { email: email };
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        });

        app.post('/carts', async (req, res) => {
            const cartItem = req.body;
            const result = await cartCollection.insertOne(cartItem);
            res.send(result);
        });

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });

        // Payments Related APIs
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            });
        });

        app.post('/payments', verifyJWT, async (req, res) => {
            const payment = req.body;
            const insertResult = await paymentCollection.insertOne(payment);

            // Delete Carts
            const query = {
                _id: { $in: payment.cartItems.map((id) => new ObjectId(id)) }
            };
            const deleteResult = await cartCollection.deleteMany(query);

            res.send({ insertResult, deleteResult });
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
