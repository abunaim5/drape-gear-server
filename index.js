const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xtia1kx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const productCollection = client.db('drapeGearDB').collection('products');
        const usersCollection = client.db('drapeGearDB').collection('users');
        const cartCollection = client.db('drapeGearDB').collection('cart');

        // login user related api
        app.post('/login', async (req, res) => {
            try {
                const { email, password } = req.body;
                const user = await usersCollection.findOne({ email });

                if (!user || !(await bcrypt.compare(password, user.password))) {
                    return res.status(401).json({ message: 'Invalid credentials' })
                }

                const accessToken = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
                const refreshToken = jwt.sign(user, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });

                // res.status(200).json({ success: true, user: { ...user, access_token: accessToken, refresh_token: refreshToken } })
                res.send({ ...user, access_token: accessToken, refresh_token: refreshToken });
            } catch (err) {
                console.error('Login error:', err);
                res.status(500).json({ message: 'Internal server error' });
            }
        });

        // create user related api
        app.post('/register', async (req, res) => {
            try {
                const { name, email, password, role } = req.body;
                // check if user already exists
                const existingUser = await usersCollection.findOne({ email });
                if (existingUser) {
                    return res.status(400).json({ message: 'User already exists' });
                }

                // hash password
                const hashPassword = await bcrypt.hash(password, 10);

                // create new user
                const newUser = {
                    name,
                    email,
                    password: hashPassword,
                    role,
                    createdAt: new Date()
                };
                await usersCollection.insertOne(newUser);
                res.status(201).json({ message: 'User registered successfully!' });
            } catch (err) {
                res.status(500).json({ message: 'Something went wrong', err });
            }
        });

        // find users related api
        app.get('/users', async (req, res) => {
            try {
                const users = await usersCollection.find().toArray();
                return res.status(200).json({ success: true, users });
            } catch (err) {
                return res.status(500).json({ success: false, message: 'failed to fetch users' });
            }
        });

        // find all product related api
        app.get('/products', async (req, res) => {
            try {
                // pagination related queries
                const page = parseInt(req.query.page);
                const size = parseInt(req.query.size);
                let skip = (page * size) - size;

                // query and options
                let query = {};

                let options = {
                    limit: size,
                    skip: skip,
                    sort: {}
                };

                // filter related queries
                const collection = req.query.filter;
                if (collection !== 'all') {
                    query.collection = collection;
                };

                // sort related queries
                const sortPriceVal = req.query.sort;
                switch (sortPriceVal) {
                    case 'default':
                        options.sort = { createdAt: -1 };
                        break;
                    case 'low':
                        options.sort.price = 1;
                        break;
                    case 'high':
                        options.sort.price = -1;
                        break;
                    default:
                        options.sort = { createdAt: -1 };
                };

                const products = await productCollection.find(query, options).toArray();
                res.status(200).json({ success: true, products });
            } catch (err) {
                res.status().json({ success: false, message: 'failed to fetch products' });
            }
        });

        // cart related apis
        app.post('/cart', async (req, res) => {
            try {
                const { email } = req.body;
                const query = {
                    email: email
                }
                const products = await cartCollection.find(query).toArray();
                return res.status(200).json({ success: true, products });
            } catch (err) {
                return res.status(500).json({ success: false, message: 'failed to fetch cart products' });
            }
        });

        app.post('/addCart', async (req, res) => {
            try {
                const { cartProduct } = req.body;
                console.log(cartProduct)
                const query = {
                    productId: cartProduct.productId
                }
                const existingProduct = await cartCollection.findOne(query);
                if (existingProduct) {
                    return res.status(400).json({ message: 'Product already exists' });
                }
                await cartCollection.insertOne(cartProduct);
                res.status(200).json({ message: 'Successfully add to cart' });
            } catch (err) {
                res.status(500).json({ message: 'Something went wrong', err });
            }
        })

        // find wishlist products
        app.post('/wishlist', async (req, res) => {
            try {
                const { wishlist } = req.body;
                if (!wishlist || !Array.isArray(wishlist)) {
                    return res.status(400).json({ message: 'Invalid wishlist data' });
                }
                const wishlistIds = wishlist.map(id => new ObjectId(id));
                const query = {
                    _id: {
                        $in: wishlistIds
                    }
                }
                const products = await productCollection.find(query).toArray();
                return res.status(200).json({ success: true, products });
            } catch (err) {
                return res.status(500).json({ success: false, message: 'failed to fetch wishlist products' });
            }
        });

        // find products with searching related api
        app.get('/searchProducts', async (req, res) => {
            try {
                const searchText = req.query.search;

                const query = {
                    name: {
                        $regex: searchText,
                        $options: 'i'
                    }
                };

                const searchResult = await productCollection.find(query).toArray();
                res.status(200).json({ success: true, searchResult });
            } catch (err) {
                res.status().json({ success: false, message: 'failed to fetch search products' });
            }
        });

        // find total product count related api
        app.get('/productCount', async (req, res) => {
            try {
                let query = {}

                const searchText = req.query.search;
                if (searchText) {
                    query.name = {
                        $regex: searchText,
                        $options: 'i'
                    }
                };

                const collection = req.query.filter;
                if (collection && collection !== 'all') {
                    query.collection = collection;
                }

                const count = await productCollection.countDocuments(query);
                res.status(200).json({ success: true, count });
            } catch (err) {
                res.status().json({ success: false, message: 'failed to fetch product count' });
            }
        });

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

// basic server apis
app.get('/', (req, res) => {
    res.send('DrapeGear Server is running');
});

app.listen(port, () => {
    console.log(`DrapeGear server is running on PORT ${port}`);
});