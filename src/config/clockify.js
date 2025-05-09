require('dotenv').config();

const clockifyConfig = {
    baseURL: 'https://api.clockify.me/api/v1',
    headers: {
        'X-Api-Key': process.env.CLOCKIFY_API_KEY,
        'Content-Type': 'application/json'
    }
};

module.exports = clockifyConfig; 