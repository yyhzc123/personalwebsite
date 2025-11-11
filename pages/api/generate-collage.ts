import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import retry from 'async-retry';
import { createCanvas, loadImage } from 'canvas';

async function fetchImage(url: string) {
  const image = await retry(
    async () => {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      return response.data;
    },
    {
      retries: 3,
    }
  );
  return image;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'POST') {
    const { games } = req.body;

    try {
      const imagePromises = games.map((game: any) => fetchImage(game.albumUrl));
      const images = await Promise.all(imagePromises);

      const canvas = createCanvas(2000, 1000);
      const ctx = canvas.getContext('2d');

      const loadedImages = await Promise.all(images.map(image => loadImage(image)));

      games.forEach((game: any, index: number) => {
        const x = game.x * canvas.width;
        const y = game.y * canvas.height;
        const width = game.width * canvas.width;
        const height = game.height * canvas.height;
        ctx.drawImage(loadedImages[index], x, y, width, height);
      });

      const buffer = canvas.toBuffer('image/png');
      res.setHeader('Content-Type', 'image/png');
      res.status(200).send(buffer);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Error generating collage' });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}