require('dotenv').config();

function secretMiddleware(req, res, next) {
    const secretHeader = req.headers['secret'];
    
    if (secretHeader !== process.env.NOTION_WEBHOOK_SECRET) {
        console.log('❌ Invalid secret');
        return res.status(401).send('Invalid secret');
    }
    
    console.log('✅ Valid secret');
    next();
}

module.exports = {
    secretMiddleware
}; 