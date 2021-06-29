import * as fileType from 'file-type';
import * as AWS from 'aws-sdk';
import helpers from './handlerHelpers';

const s3 = new AWS.S3();

const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg', 'image/svg'];

export const imageUpload = async (body) => {

  try {

    if (!body || !body.image || !body.mime) {

      return helpers.createResponse(400, {
        message: 'incorrect body on request'
      });

    }

    if (!allowedMimes.includes(body.mime)) {

      return helpers.createResponse(400, {
        message: 'mime is not allowed'
      });

    }

    let imageData = body.image;
    if (body.image.substr(0, 7) === 'base64,') {

      imageData = body.image.substr(7, body.image.length);

    }

    const buffer = Buffer.from(imageData, 'base64');
    const fileInfo = await fileType.fromBuffer(buffer);
    const detectedExt = fileInfo.ext;
    const detectedMime = fileInfo.mime;

    if (detectedMime !== body.mime) {

      return helpers.createResponse(400, {
        message: 'mime types don\'t match'
      });

    }

    const id = body.id;
    const key = 'stickers/' + id + '.' + detectedExt;

    await s3
      .putObject({
        Body: buffer,
        Key: key,
        ContentType: body.mime,
        Bucket: process.env.stickerImagesBucket,
        ACL: 'public-read',
      })
      .promise();

    const url = `https://${process.env.stickerImagesBucket}.s3-${process.env.region}.amazonaws.com/${key}`;
    return helpers.createResponse(200, {
      imageURL: url,
      s3ObjectKey: key
    });

  } catch (error) {

    console.log('error', error);

    return helpers.createResponse(400, {
      message: error.message || 'Failed to upload image'
    });

  }

};

export const deleteObject = async (body) => {

  try {

    const id = body.id;
    const key = body.key;

    await s3
      .deleteObject({
        Key: key,
        Bucket: process.env.stickerImagesBucket
      })
      .promise();

    return helpers.createResponse(200, { message: 'Success' });

  } catch (error) {

    console.log('error', error);

    return helpers.createResponse(400, {
      message: error.message || 'Failed to upload image'
    });

  }

};
