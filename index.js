require("dotenv").config();
const bcrypt = require("bcrypt");
const express = require("express");
const multer = require("multer");
const https = require('https');
const FormData = require('form-data');
const path = require("path");
const cors = require("cors");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/'); // Make sure this folder exists and is writable
    },
    filename: function (req, file, cb) {
      const uniqueName = Date.now() + '-' + file.originalname;
      cb(null, uniqueName);
    }
});
  
const upload = multer({ storage: storage });

// Database Connection
const pool = new Pool({
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "localhost",
    database: process.env.DB_DATABASE || "blog_system",
    password: process.env.DB_PASSWORD || "yourpassword",
    port: process.env.DB_PORT || 5432
});

// Test Database Connection
pool.connect((err, client, release) => {
    if (err) {
        console.error("Database connection error:", err.stack);
    } else {
        console.log("Connected to PostgreSQL database!");
    }
});

const SECRET_KEY = "your_secret_key"; // Change this to a secure secret key

// Test API
app.get("/", (req, res) => {
    res.send("Blog API is running!");
});

function authenticateToken(req, res, next) {
    const token = req.headers["authorization"]?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Access denied!" });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid token!" });
        req.user = user;
        next();
    });
}


// AI Image Generation
app.post("/generate-image", authenticateToken, async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: "Image prompt is required!" });

        // Make sure the uploads directory exists
        const fs = require('fs');
        const path = require('path');
        const uploadsDir = path.join(__dirname, 'uploads');
        
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        console.log("Starting AI image generation with prompt:", prompt);

        // Create FormData 
        const FormData = require('form-data');
        const form = new FormData();
        form.append('prompt', prompt);
        form.append('style', 'realistic');
        form.append('width', '512');
        form.append('height', '512');

        try {
            // Log the API key
            const apiKey = process.env.IMAGINE_ART_API_KEY;
            console.log("Using API key:", apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : "Missing API key");
            
            // Make the API call with proper headers
            const response = await axios.post(
                "https://api.vyro.ai/v2/image/generations",
                form,
                {
                    headers: {
                        ...form.getHeaders(),
                        "Authorization": `Bearer ${apiKey}`
                    },
                    // Set responseType to arraybuffer to handle binary data
                    responseType: 'arraybuffer',
                    // Longer timeout for image generation
                    timeout: 30000
                }
            );
            
            console.log("API Response Status:", response.status);
            
            // Check if the response is actually binary image data
            const contentType = response.headers['content-type'];
            console.log("Content-Type:", contentType);
            
            if (contentType && contentType.includes('image/')) {
                // The response is directly an image
                // Generate unique filename
                const imageName = `ai-generated-${Date.now()}.png`;
                const imagePath = path.join(uploadsDir, imageName);
                
                console.log("Saving AI image to:", imagePath);
                
                // Save the image to uploads folder
                fs.writeFileSync(imagePath, response.data);
                
                res.json({ 
                    success: true, 
                    filename: imageName,
                    message: "AI image generated successfully!"
                });
            } else {
                // Try to parse as JSON if not an image
                try {
                    const textData = Buffer.from(response.data).toString('utf8');
                    const jsonData = JSON.parse(textData);
                    
                    console.log("Response parsed as JSON:", Object.keys(jsonData));
                    
                    if (jsonData.image_url) {
                        // Download the image from the URL
                        const imageResponse = await axios.get(jsonData.image_url, { 
                            responseType: 'arraybuffer' 
                        });
                        
                        // Generate unique filename
                        const imageName = `ai-generated-${Date.now()}.png`;
                        const imagePath = path.join(uploadsDir, imageName);
                        
                        console.log("Saving AI image to:", imagePath);
                        
                        // Save the image to uploads folder
                        fs.writeFileSync(imagePath, imageResponse.data);
                        
                        res.json({ 
                            success: true, 
                            filename: imageName,
                            message: "AI image generated successfully!"
                        });
                    } else {
                        console.error("API didn't return an image URL:", jsonData);
                        res.status(500).json({ error: "API didn't return an image URL", details: jsonData });
                    }
                } catch (parseError) {
                    console.error("Failed to parse response:", parseError.message);
                    
                    // The response might be directly a binary image without proper content-type
                    // Save it as an image anyway as a fallback
                    const imageName = `ai-generated-${Date.now()}.png`;
                    const imagePath = path.join(uploadsDir, imageName);
                    
                    console.log("Attempting to save response as image to:", imagePath);
                    
                    // Save the response data to uploads folder
                    fs.writeFileSync(imagePath, response.data);
                    
                    res.json({ 
                        success: true, 
                        filename: imageName,
                        message: "AI image generated and saved (fallback method)"
                    });
                }
            }
        } catch (apiError) {
            console.error("AI API Error:", apiError.message);
            
            if (apiError.response) {
                console.log("Response Status:", apiError.response.status);
                console.log("Response Headers:", JSON.stringify(apiError.response.headers));
                
                if (apiError.response.data) {
                    if (Buffer.isBuffer(apiError.response.data)) {
                        console.log("Response is binary data (buffer)");
                        // Try to convert to string for debugging if it's not too large
                        try {
                            const preview = Buffer.from(apiError.response.data).toString('utf8').substring(0, 200);
                            console.log("Binary data preview:", preview);
                        } catch (e) {
                            console.log("Could not convert binary data to string");
                        }
                    } else if (typeof apiError.response.data === 'object') {
                        console.log("Response Data:", JSON.stringify(apiError.response.data, null, 2));
                    } else {
                        console.log("Response Data (first 200 chars):", String(apiError.response.data).substring(0, 200));
                    }
                }
            }
            
            res.status(500).json({ error: "Failed to generate AI image", message: apiError.message });
        }
    } catch (err) {
        console.error("AI Image Generation Error:", err.message);
        res.status(500).json({ error: "Failed to generate image!" });
    }
});

// Post a Blog with image upload
app.post("/blogs", authenticateToken, upload.single("image"), async (req, res) => {
    try {
        const { title, content, aiGeneratedImage } = req.body;
        const authorId = req.user.userId; // Get userId from JWT payload
        
        // Determine image URL from either uploaded file or AI-generated image
        let image_url = null;
        if (req.file) {
            image_url = req.file.filename;
        } else if (aiGeneratedImage) {
            image_url = aiGeneratedImage;
        }

        if (!title || !content) {
            return res.status(400).json({ error: "Title and content cannot be empty!" });
        }

        await pool.query(
            "INSERT INTO blogs (author_id, title, content, created_at, likes, reports, views, image_url) VALUES ($1, $2, $3, NOW(), 0, 0, 0, $4)", 
            [authorId, title, content, image_url]
        );
        
        console.log('Image URL:', image_url);
        console.log('Request Body:', req.body);

        res.json({ message: "Blog posted successfully!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to post blog!" });
    }
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Save as Draft with user association
app.post("/drafts", authenticateToken, async (req, res) => {
    try {
        const { title, content } = req.body;
        const userId = req.user.userId;

        if (!content) {
            return res.status(400).json({ error: "Content cannot be empty!" });
        }

        await pool.query(
            "INSERT INTO drafts (user_id, title, content, created_at) VALUES ($1, $2, $3, NOW())", 
            [userId, title, content]
        );

        res.json({ message: "Draft saved successfully!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to save draft!" });
    }
});
// Fetch All Blogs randomly
app.get("/all-blogs", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT blogs.id, blogs.title, blogs.image_url, users.username FROM blogs JOIN users ON blogs.author_id = users.id ORDER BY RANDOM()"
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch all blogs!" });
    }
});

// Get user's drafts
app.get("/my-drafts", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const result = await pool.query(
            "SELECT * FROM drafts WHERE user_id = $1 ORDER BY created_at DESC", 
            [userId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch drafts!" });
    }
});

// Get user's blogs
app.get("/my-blogs", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const result = await pool.query(
            "SELECT * FROM blogs WHERE author_id = $1 ORDER BY created_at DESC", 
            [userId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch your blogs!" });
    }
});

// Fetch Latest Blogs with just title and image for previews
app.get("/latest-blogs", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT blogs.id, blogs.title, blogs.image_url, users.username FROM blogs JOIN users ON blogs.author_id = users.id ORDER BY created_at DESC LIMIT 5"
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch blogs!" });
    }
});

// Fetch Trending Blogs with just title and image for previews
app.get("/trending-blogs", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT blogs.id, blogs.title, blogs.image_url, users.username FROM blogs JOIN users ON blogs.author_id = users.id ORDER BY views DESC LIMIT 5"
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch trending blogs!" });
    }
});

// NEW ENDPOINT: Get a single blog by ID and increment view count
// Fetch a specific blog
app.get("/blog/:id", async (req, res) => {
    try {
        const blogId = req.params.id;
        
        // Get the blog details with author name
        const result = await pool.query(
            "SELECT blogs.*, users.username FROM blogs JOIN users ON blogs.author_id = users.id WHERE blogs.id = $1",
            [blogId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Blog not found!" });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch blog!" });
    }
});

// Increment view count for a blog
app.post("/blog/:id/view", async (req, res) => {
    try {
        const blogId = req.params.id;
        
        // Increment the view count
        await pool.query(
            "UPDATE blogs SET views = views + 1 WHERE id = $1",
            [blogId]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update view count!" });
    }
});

// Check if the current user has liked a blog
app.get("/blog/:id/liked", authenticateToken, async (req, res) => {
    try {
        const blogId = req.params.id;
        const userId = req.user.id;
        
        const result = await pool.query(
            "SELECT * FROM likes WHERE blog_id = $1 AND user_id = $2",
            [blogId, userId]
        );
        
        res.json({ liked: result.rows.length > 0 });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to check like status!" });
    }
});

// Toggle like status for a blog
app.post("/blog/:id/like", authenticateToken, async (req, res) => {
    try {
        const blogId = req.params.id;
        const userId = req.user.id;
        
        // Check if user already liked this blog
        const likeCheck = await pool.query(
            "SELECT * FROM likes WHERE blog_id = $1 AND user_id = $2",
            [blogId, userId]
        );
        
        let liked = false;
        
        // If like exists, remove it (unlike)
        if (likeCheck.rows.length > 0) {
            await pool.query(
                "DELETE FROM likes WHERE blog_id = $1 AND user_id = $2",
                [blogId, userId]
            );
        } 
        // Otherwise add a new like
        else {
            await pool.query(
                "INSERT INTO likes (blog_id, user_id) VALUES ($1, $2)",
                [blogId, userId]
            );
            liked = true;
        }
        
        // Get the updated like count
        const likeCountResult = await pool.query(
            "SELECT COUNT(*) FROM likes WHERE blog_id = $1",
            [blogId]
        );
        
        // Update the likes count in the blogs table
        await pool.query(
            "UPDATE blogs SET likes = $1 WHERE id = $2",
            [parseInt(likeCountResult.rows[0].count), blogId]
        );
        
        res.json({ 
            liked: liked,
            likes: parseInt(likeCountResult.rows[0].count)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update like status!" });
    }
});

// Signup Route
app.post("/signup", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: "Username and password are required!" });
        }

        // Check if username already exists
        const existingUser = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: "Username already exists!" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id",
            [username, email, hashedPassword]
        );

        res.status(201).json({ userId: result.rows[0].id, message: "User registered successfully!" });
    } catch (err) {
        console.error("Signup error:", err);
        res.status(500).json({ error: "User registration failed!" });
    }
});

// Login Route
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await pool.query("SELECT * FROM users WHERE username = $1 OR email = $1", [username]);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: "User not found!" });
        }

        const validPassword = await bcrypt.compare(password, user.rows[0].password);
        if (!validPassword) {
            return res.status(401).json({ error: "Invalid password!" });
        }

        const token = jwt.sign({ userId: user.rows[0].id }, SECRET_KEY, { expiresIn: "1h" });

        res.json({ 
            message: "Login successful!", 
            token, 
            user: { username: user.rows[0].username }
        });
        
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// Protected Home Route
app.get("/home", authenticateToken, (req, res) => {
    res.json({ message: "Welcome to your home page!", user: { username: req.user.username } });
});

// AI Suggestions
app.post("/ai-suggestions", async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: "Prompt is required!" });

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GOOGLE_AI_API_KEY}`,
            {
                contents: [{ parts: [{ text: prompt }] }]
            },
            {
                headers: { "Content-Type": "application/json" }
            }
        );

        res.json({ suggestion: response.data.candidates?.[0]?.content?.parts?.[0]?.text || "No suggestion available" });
    } catch (err) {
        console.error("AI Suggestion Error:", err.response?.data || err.message);
        res.status(500).json({ error: "Failed to fetch AI suggestions!" });
    }
});

// Serve static files (Add this to serve the HTML, CSS and JS files)
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
