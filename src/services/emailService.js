const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000
});

const enviarCorreo = async (to, subject, html) => {
    try {
        await transporter.sendMail({
            from: `"Laboratorio Clínico Garófalo" <${process.env.EMAIL_FROM}>`,
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