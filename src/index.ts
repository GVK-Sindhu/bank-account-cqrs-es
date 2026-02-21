import app from './app.js';

const PORT = process.env.API_PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
