const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'storage/firmas/');
    },
    filename: (req, file, cb) => {
        // Nombre único: firma-IDUSUARIO-timestamp.png
        const extension = path.extname(file.originalname);
        cb(null, `firma-${req.user.id}-${Date.now()}${extension}`);
    }
});

const upload = multer({ storage });
module.exports = upload;