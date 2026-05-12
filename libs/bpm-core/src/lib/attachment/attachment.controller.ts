import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { AttachmentService } from './attachment.service';

@Controller('attachments')
export class AttachmentController {
  constructor(private readonly attachmentService: AttachmentService) {}

  @Get(':id/download')
  async downloadAttachment(
    @Param('id') id: string,
    @Query('token') token: string,
    @Query('disposition') disposition: 'attachment' | 'inline' = 'attachment',
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { attachment, buffer } =
      await this.attachmentService.readSignedAttachment({
        disposition,
        id,
        token,
      });

    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(attachment.filename)}"`,
    );
    response.setHeader('Content-Length', String(buffer.length));

    return new StreamableFile(buffer);
  }
}
