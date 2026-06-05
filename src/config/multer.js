const multer = require('multer');

// Usamos memoria en vez de disco — el buffer se sube directo a Supabase Storage
const storage = multer.memoryStorage();

const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB máximo
    fileFilter: (req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/jpg'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten imágenes PNG o JPG'));
        }
    }
});

module.exports = upload;