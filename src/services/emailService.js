const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,          // ← de 465 a 587
    secure: false,      // ← de true a false (STARTTLS en lugar de SSL)
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const enviarCorreo = async (to, subject, html) => {
    try {
        await transporter.sendMail({
            from: `"Laboratorio Clínico Garófalo" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html
        });
        console.log('Correo enviado a:', to);
        return true;
    } catch (error) {
        console.error('Error SMTP:', error);
        return false;
    }
};

module.exports = { enviarCorreo };