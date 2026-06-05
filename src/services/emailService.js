const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const enviarCorreo = async (to, subject, html) => {
    try {
        await transporter.sendMail({
            from: '"Laboratorio Clínico 🔬" <tu-correo@gmail.com>',
            to,
            subject,
            html
        });
        return true;
    } catch (error) {
        console.error("Error al enviar correo:", error);
        return false;
    }
};

module.exports = { enviarCorreo };