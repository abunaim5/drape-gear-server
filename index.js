require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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
        // await client.connect();

        const productCollection = client.db('drapeGearDB').collection('products');
        const orderCollection = client.db('drapeGearDB').collection('orders');
        const usersCollection = client.db('drapeGearDB').collection('users');
        const cartCollection = client.db('drapeGearDB').collection('cart');

        // middlewares
        const verifyToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) return res.status(401).send({ message: 'Unauthorized access' });

            const token = authHeader.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) return res.status(401).send({ message: 'Invalid or expired token' });

                req.decoded = decoded;
                next();
            });
        };

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) return res.status(403).send({ message: 'forbidden access' });

            next();
        };

        const verifyUser = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const isUser = user?.role === 'user';
            if (!isUser) return res.status(403).send({ message: 'forbidden access' });

            next();
        };

        // login user related api
        app.post('/login', async (req, res) => {
            try {
                const { email, password } = req.body;
                console.log(email, password);
                const user = await usersCollection.findOne({ email });

                if (!user || !(await bcrypt.compare(password, user.password))) {
                    return res.status(401).json({ message: 'Invalid credentials' })
                }
                const payload = { _id: user._id, email: user.email, role: user.role };

                const accessToken = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
                const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '7d' });

                return res.status(200).json({ ...user, access_token: accessToken, refresh_token: refreshToken, sub_id: '' });
            } catch (err) {
                return res.status(500).json({ message: 'Internal server error' });
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
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const users = await usersCollection.find().toArray();
                return res.status(200).json({ success: true, users });
            } catch (err) {
                return res.status(500).json({ success: false, message: 'failed to fetch users' });
            }
        });

        // products related api
        app.post('/addProduct', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const options = {
                    sort: {
                        createdAt: -1
                    }
                }
                const { newProduct } = req.body;
                await productCollection.insertOne(newProduct);
                const updatedProducts = await productCollection.find({}, options).toArray();
                res.status(200).json({ success: true, products: updatedProducts });
            } catch (err) {
                res.status(500).json({ message: 'Something went wrong', err });
            }
        });

        // update product api
        app.patch('/products/:id', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const id = req.params.id;
                const { updatedData } = req.body;
                const filter = { _id: new ObjectId(id) };
                const updateDoc = {
                    $set: {
                        ...updatedData
                    }
                };
                const options = {
                    sort: {
                        createdAt: -1
                    }
                }
                await productCollection.updateOne(filter, updateDoc);
                const updatedProducts = await productCollection.find({}, options).toArray();
                res.status(200).json({ success: true, products: updatedProducts });
            } catch (err) {
                res.status(500).json({ message: 'Something went wrong', err });
            }

        });

        app.post('/removeProduct', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const { id } = req.body;
                const query = {
                    _id: new ObjectId(id)
                };
                const options = {
                    sort: {
                        createdAt: -1
                    }
                }
                await productCollection.deleteOne(query);
                const updatedProducts = await productCollection.find({}, options).toArray();
                res.status(200).json({ success: true, products: updatedProducts });
            } catch (err) {
                res.status(500).json({ message: 'Something went wrong', err });
            }
        });

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

                // collection filter related queries
                const collection = req.query.filter;
                if (collection !== 'all') {
                    query.collection = collection;
                };

                // category filter related queries
                const categories = req.query.category?.split(',') ?? [];
                if (categories.length > 0) {
                    query.category = {
                        $in: categories
                    }
                };

                // availability filter related queries
                const availability = req.query.availability?.split(',') ?? [];
                const availabilityFilter = availability.map(avail => avail === 'true');
                if (availability.length > 0) {
                    query.availability = {
                        $in: availabilityFilter
                    }
                };

                // sort related queries
                const sortPriceVal = req.query.sort;
                switch (sortPriceVal) {
                    case 'default':
                        options.sort = { createdAt: -1 };
                        break;
                    case 'low':
                        options.sort.sale_price = 1;
                        break;
                    case 'high':
                        options.sort.sale_price = -1;
                        break;
                    default:
                        options.sort = { createdAt: -1 };
                };

                const products = await productCollection.find(query, options).toArray();
                res.status(200).json({ success: true, products });
            } catch (err) {
                res.status(500).json({ success: false, message: 'Failed to fetch products' });
            }
        });

        app.get('/allProducts', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const query = {}
                const options = {
                    sort: {
                        createdAt: -1
                    }
                }
                const products = await productCollection.find(query, options).toArray();
                return res.status(200).json({ success: true, products });
            } catch (err) {
                return res.status(500).json({ success: false, message: 'failed to fetch all products' });
            }
        });

        app.get('/product/:id', async (req, res) => {
            try {
                const productId = (req.params.id);
                const query = {
                    _id: new ObjectId(productId)
                }
                const product = await productCollection.findOne(query);
                res.status(200).json({ success: true, product });
            } catch (err) {
                res.status(500).json({ success: false, message: 'Failed to fetch product' });
            }
        });

        // find product unique categories related api
        app.get('/categories', async (req, res) => {
            try {
                const collection = req.query.collection;
                let $match = {}
                if (collection !== 'all') {
                    $match.collection = collection;
                }
                const categoryPipeline = [
                    {
                        $match
                    },
                    {
                        $group: {
                            _id: '$category',
                            totalProducts: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            category: '$_id',
                            totalProducts: 1
                        }
                    }
                ];

                const availabilityPipeline = [
                    {
                        $match
                    },
                    {
                        $group: {
                            _id: '$availability',
                            totalAvailability: { $sum: 1 }
                        }
                    },
                    {
                        $project: {
                            _id: 0,
                            availability: '$_id',
                            totalAvailability: 1
                        }
                    }
                ];

                const [categories, availabilityData] = await Promise.all([
                    productCollection.aggregate(categoryPipeline).toArray(),
                    productCollection.aggregate(availabilityPipeline).toArray()
                ]);
                res.status(200).json({ success: true, categories, availabilityData });
            } catch (error) {
                return res.status(500).json({ success: false, message: 'failed to fetch categories' });
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
                res.status(500).json({ success: false, message: 'failed to fetch product count' });
            }
        });

        // cart related apis
        app.post('/cart', verifyToken, verifyUser, async (req, res) => {
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

        app.post('/addCart', verifyToken, verifyUser, async (req, res) => {
            try {
                const { cartProduct } = req.body;
                const query = {
                    email: cartProduct.email,
                    productId: cartProduct.productId
                }
                const existingProduct = await cartCollection.findOne(query);
                if (existingProduct) {
                    return res.status(400).json({ message: 'Product already exists' });
                }
                await cartCollection.insertOne(cartProduct);
                const updatedProducts = await cartCollection.find({ email: cartProduct.email }).toArray();
                res.status(200).json({ success: true, products: updatedProducts });
            } catch (err) {
                res.status(500).json({ message: 'Something went wrong', err });
            }
        });

        app.post('/removeCart', verifyToken, verifyUser, async (req, res) => {
            try {
                const { id, email } = req.body;
                const query = {
                    _id: new ObjectId(id)
                };
                await cartCollection.deleteOne(query);
                const updatedProducts = await cartCollection.find({ email: email }).toArray();
                res.status(200).json({ success: true, products: updatedProducts });
            } catch (err) {
                res.status(500).json({ message: 'Something went wrong', err });
            }
        });

        app.patch('/cartQuantity/:id', verifyToken, verifyUser, async (req, res) => {
            try {
                const id = req.params.id;
                const { email, productQuantity } = req.body;
                const filter = {
                    _id: new ObjectId(id)
                };
                const updateDoc = {
                    $set: {
                        quantity: productQuantity
                    }
                }
                await cartCollection.updateOne(filter, updateDoc);
                const updatedProducts = await cartCollection.find({ email: email }).toArray();
                res.status(200).json({ success: true, products: updatedProducts });
            } catch (err) {
                res.status(500).json({ message: 'Something went wrong', err });
            }
        });

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
                res.status(500).json({ success: false, message: 'failed to fetch search products' });
            }
        });

        // find ordered products api
        app.post('/orders', verifyToken, async (req, res) => {
            try {
                const { email } = req.body;
                const query = {
                    email: email
                }
                const user = await usersCollection.findOne(query);
                const isAdmin = user.role === 'admin';
                if (isAdmin) {
                    const orders = await orderCollection.find().toArray();
                    res.status(200).json({ success: true, orders });
                } else {
                    const orders = await orderCollection.find({ user_email: email }).toArray();
                    res.status(200).json({ success: true, orders });
                }
            } catch (err) {
                res.status(500).json({ success: false, message: 'failed to fetch ordered products' });
            }

        });

        // payment system
        app.post('/orderedProducts', verifyToken, verifyUser, async (req, res) => {
            try {
                const orderInfo = req.body;
                const result = await orderCollection.insertOne(orderInfo);
                res.status(200).json({ success: true, result });
            } catch (err) {
                res.status(500).json({ success: false, message: 'failed to add ordered products info' });
            }
        });

        // payment intent
        app.post('/create-payment-intent', verifyToken, verifyUser, async (req, res) => {
            try {
                const { price } = req.body;
                const amount = parseInt(price * 100);

                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amount,
                    currency: 'usd',
                    payment_method_types: ['card']
                });
                res.status(200).json({ success: true, clientSecret: paymentIntent.client_secret });
            } catch (err) {
                res.status(500).json({ success: false, message: 'failed to create payment intent' });
            }
        });

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
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