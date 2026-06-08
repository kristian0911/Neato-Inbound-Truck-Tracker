import { handleUpload } from '@vercel/blob/client';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const body = req.body;
        const jsonResponse = await handleUpload({
            body,
            request: req,
            onBeforeGenerateToken: async (/* pathname */) => ({
                allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
                maximumSizeInBytes: 10 * 1024 * 1024,
                addRandomSuffix: true,
            }),
            onUploadCompleted: async (/* { blob, tokenPayload } */) => {
                // no-op; hook reserved for future audit/logging
            },
        });
        return res.status(200).json(jsonResponse);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
}
