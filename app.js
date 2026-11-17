require('dotenv').config();
const bycrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('./models/user');
const Post = require('./models/post');
const mongoose = require('mongoose');
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const upload = require('./utils/multer');

const JWT_SECRET = process.env.JWT_SECRET || 'my_super_secret_pinterest_key_123';
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/pintrest-clone';
mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('✅ Connected to MongoDB Atlas Cloud Database successfully!');
    })
    .catch((err) => {
        console.error('❌ MongoDB connection error:', err);
    });

function isLoggedIn(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.redirect('/login');
    try {
        const data = jwt.verify(token, JWT_SECRET);
        req.user = data;
        next();
    } catch (err) {
        res.clearCookie('token');
        return res.redirect('/login');
    }
}

app.get('/', (req, res) => {
    if (req.cookies.token) return res.redirect('/feed');
    res.render('index');
});

app.get('/feed', isLoggedIn, async (req, res) => {
    try {
        const posts = await Post.find().populate('user').sort({ createdAt: -1 });
        res.render('feed', { posts });
    } catch (error) {
        console.error('Feed error:', error);
        res.status(500).send('Something went wrong during feed fetch.');
    }
});

app.get('/create-pin', isLoggedIn, (req, res) => {
    res.render('createPin');
});

app.post('/create-pin', isLoggedIn, upload.single('image'), async (req, res) => {
    try {
        const { title, description } = req.body;
        if (!req.file) {
            return res.status(400).send('Please upload an image.');
        }
        const imagePath = `/images/uploads/${req.file.filename}`;
        const newPost = await Post.create({
            title,
            description,
            image: imagePath,
            user: req.user.userId
        });
        const user = await User.findById(req.user.userId);
        user.posts.push(newPost._id);
        await user.save();
        res.redirect('/profile');
    } catch (error) {
        console.error('Error creating pin:', error);
        res.status(500).send(error.message);
    }
});

app.post('/save/:postId', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        const postId = req.params.postId;

        const isAlreadySaved = user.saved.some(id => id.toString() === postId);
        if (isAlreadySaved) {
            user.saved = user.saved.filter(id => id.toString() !== postId);
        } else {
            user.saved.push(postId);
        }

        await user.save();
        res.redirect('/feed');
    } catch (error) {
        console.error('Error in saving pin:', error);
        res.status(500).send('Failed to save pin');
    }
});

app.post('/delete-pin/:postId', isLoggedIn, async (req, res) => {
    try {
        const { postId } = req.params;
        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).send('Pin not found.');
        }

        if (post.user.toString() !== req.user.userId) {
            return res.status(403).send('Forbidden: You can only delete your own pins!');
        }

        await Post.findByIdAndDelete(postId);
        await User.findByIdAndUpdate(req.user.userId, {
            $pull: { posts: postId }
        });
        await User.updateMany(
            { saved: postId },
            { $pull: { saved: postId } }
        );

        res.redirect('/profile');
    } catch (error) {
        console.error('Delete pin error:', error);
        res.status(500).send('Error deleting pin.');
    }
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).send('User not found');
        
        const isMatch = await bycrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).send('Invalid password');

        const token = jwt.sign(
            { userId: user._id, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.redirect('/profile');
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).send('Something went wrong during login.');
    }
});

app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', async (req, res) => {
    try {
        const { username, name, email, password } = req.body;
        const existingUser = await User.findOne({
            $or: [{ email }, { username }]
        });
        if (existingUser) {
            return res.status(400).send('User with this email or username already exists. Please use different credentials.');
        }

        const hashedPassword = await bycrypt.hash(password, 10);
        const newUser = await User.create({
            username,
            name,
            email,
            password: hashedPassword
        });

        const token = jwt.sign(
            { userId: newUser._id, email: newUser.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.redirect('/profile');
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).send('Something went wrong during registration');
    }
});

app.get('/profile', isLoggedIn, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate('posts').populate('saved');
        if (!user) {
            res.clearCookie('token');
            return res.redirect('/register');
        }
        res.render('profile', { user });
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).send('Something went wrong while fetching profile');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Web server started! Running on http://localhost:${PORT}`);
});
