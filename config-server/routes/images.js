/**
 * Memora 图片同步路由 v3.1
 * 图片文件上传/下载/绑定/删除/增量拉取
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db } = require('../database');
const { memoraAuth } = require('../middleware/auth');

router.use(memoraAuth);

// 图片存储目录
const NOTE_IMAGES_DIR = path.join(__dirname, '..', 'uploads', 'note-images');
if (!fs.existsSync(NOTE_IMAGES_DIR)) fs.mkdirSync(NOTE_IMAGES_DIR, { recursive: true });

// multer 配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(NOTE_IMAGES_DIR, req.user.id || 'unknown');
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'].includes(file.mimetype);
    cb(ok ? null : new Error('不支持的图片格式: ' + file.mimetype), ok);
  }
});

/**
 * 解析图片尺寸（直接读文件头，无外部依赖）
 */
function getImageDimensions(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 12) return { w: 0, h: 0 };

    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    // JPEG
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      let offset = 2;
      while (offset < buf.length - 9) {
        if (buf[offset] !== 0xFF) break;
        const marker = buf[offset + 1];
        if (marker === 0xC0 || marker === 0xC2) {
          return { h: buf.readUInt16BE(offset + 5), w: buf.readUInt16BE(offset + 7) };
        }
        offset += 2 + buf.readUInt16BE(offset + 2);
      }
    }
    // GIF
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    }
    // BMP
    if (buf[0] === 0x42 && buf[1] === 0x4D) {
      return { w: buf.readUInt32LE(18), h: Math.abs(buf.readInt32LE(22)) };
    }
    // WebP
    if (buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
      if (buf.readUInt32LE(12) === 0x38504956) {
        return { w: buf.readUInt16LE(26) & 0x3FFF, h: (buf.readUInt32LE(26) >> 14) & 0x3FFF };
      }
      if (buf.readUInt32LE(12) === 0x4C385056) {
        const bits = buf.readUInt32LE(21);
        return { w: (bits & 0x3FFF) + 1, h: ((bits >> 14) & 0x3FFF) + 1 };
      }
    }
    return { w: 0, h: 0 };
  } catch {
    return { w: 0, h: 0 };
  }
}

// ===== POST /upload — 上传图片 =====
router.post('/upload', upload.array('images', 5), (req, res) => {
  const userId = req.user.id;
  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).json({ ok: false, error: '未提供图片文件' });
  }

  const uploaded = [];
  const errors = [];

  for (const file of files) {
    try {
      const imageId = `img_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const { w, h } = getImageDimensions(file.path);
      const serverPath = `${userId}/${file.filename}`;
      const fileBuf = fs.readFileSync(file.path);
      const imageHash = crypto.createHash('sha256').update(fileBuf).digest('hex');
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO note_images (id, user_id, note_id, filename, original_name, server_path,
          file_size, mime_type, image_hash, width, height, origin_device_id, revision, created_at, updated_at)
        VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(imageId, userId, file.filename, file.originalname || '', serverPath,
        file.size, file.mimetype || 'image/png', imageHash, w, h,
        req.body?.device_id || '', now, now);

      uploaded.push({
        id: imageId,
        filename: file.filename,
        original_name: file.originalname || '',
        server_path: serverPath,
        download_url: `/memora/sync/notes/images/${imageId}/download`,
        file_size: file.size,
        mime_type: file.mimetype || 'image/png',
        image_hash: imageHash,
        width: w,
        height: h
      });
    } catch (e) {
      console.error('[Images] Upload error:', e.message);
      if (file.path && fs.existsSync(file.path)) {
        try { fs.unlinkSync(file.path); } catch {}
      }
      errors.push({ filename: file.originalname, error: e.message });
    }
  }

  res.json({ ok: true, uploaded, errors: errors.length > 0 ? errors : undefined, count: uploaded.length });
});

// ===== GET /:imageId/download — 下载图片文件 =====
router.get('/:imageId/download', (req, res) => {
  const img = db.prepare('SELECT * FROM note_images WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(req.params.imageId, req.user.id);
  if (!img) return res.status(404).json({ ok: false, error: '图片不存在' });

  const filePath = path.join(NOTE_IMAGES_DIR, img.server_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: '图片文件丢失' });

  res.setHeader('Content-Type', img.mime_type || 'image/png');
  res.setHeader('Content-Disposition', `inline; filename="${img.original_name || img.filename}"`);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(filePath).pipe(res);
});

// ===== GET /:imageId — 获取图片元数据 =====
router.get('/:imageId', (req, res) => {
  const img = db.prepare('SELECT * FROM note_images WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(req.params.imageId, req.user.id);
  if (!img) return res.status(404).json({ ok: false, error: '图片不存在' });

  res.json({
    ok: true,
    image: {
      id: img.id, user_id: img.user_id, note_id: img.note_id,
      filename: img.filename, original_name: img.original_name,
      server_path: img.server_path, file_size: img.file_size,
      mime_type: img.mime_type, image_hash: img.image_hash,
      width: img.width, height: img.height, revision: img.revision,
      created_at: img.created_at,
      download_url: `/memora/sync/notes/images/${img.id}/download`
    }
  });
});

// ===== GET / — 图片列表 =====
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const noteId = req.query.note_id;
  const offset = (page - 1) * limit;

  let countQ = 'SELECT COUNT(*) as total FROM note_images WHERE user_id = ? AND deleted_at IS NULL';
  let listQ = 'SELECT * FROM note_images WHERE user_id = ? AND deleted_at IS NULL';
  const params = [req.user.id];

  if (noteId) {
    countQ += ' AND note_id = ?';
    listQ += ' AND note_id = ?';
    params.push(noteId);
  }
  listQ += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

  const total = db.prepare(countQ).get(...params).total;
  const images = db.prepare(listQ).all(...params, limit, offset);

  res.json({
    ok: true, total, page, limit,
    images: images.map(i => ({
      id: i.id, note_id: i.note_id, filename: i.filename,
      server_path: i.server_path,
      download_url: `/memora/sync/notes/images/${i.id}/download`,
      file_size: i.file_size, image_hash: i.image_hash,
      width: i.width, height: i.height, mime_type: i.mime_type,
      revision: i.revision, created_at: i.created_at, updated_at: i.updated_at
    }))
  });
});

// ===== POST /batch-download — 批量获取图片元数据 =====
router.post('/batch-download', (req, res) => {
  const { image_ids } = req.body;
  if (!Array.isArray(image_ids) || !image_ids.length) {
    return res.status(400).json({ ok: false, error: 'image_ids 必填且不能为空' });
  }
  if (image_ids.length > 50) {
    return res.status(400).json({ ok: false, error: '单次最多查询 50 个图片' });
  }

  const images = db.prepare(
    `SELECT * FROM note_images WHERE user_id = ? AND id IN (${image_ids.map(() => '?').join(',')}) AND deleted_at IS NULL`
  ).all(req.user.id, ...image_ids);

  res.json({
    ok: true,
    images: images.map(i => ({
      id: i.id, note_id: i.note_id, server_path: i.server_path,
      download_url: `/memora/sync/notes/images/${i.id}/download`,
      file_size: i.file_size, image_hash: i.image_hash,
      width: i.width, height: i.height, mime_type: i.mime_type,
      revision: i.revision, created_at: i.created_at, updated_at: i.updated_at
    }))
  });
});

// ===== PUT /:imageId/bind — 绑定图片到笔记 =====
router.put('/:imageId/bind', (req, res) => {
  const { note_id } = req.body;
  if (!note_id) return res.status(400).json({ ok: false, error: 'note_id 必填' });

  const img = db.prepare('SELECT * FROM note_images WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(req.params.imageId, req.user.id);
  if (!img) return res.status(404).json({ ok: false, error: '图片不存在' });

  const now = new Date().toISOString();
  const newRev = img.revision + 1;

  db.prepare('UPDATE note_images SET note_id = ?, revision = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(note_id, newRev, now, req.params.imageId, req.user.id);

  db.prepare(`UPDATE user_notes SET category = 'image', image_path = ?, image_hash = ?, image_width = ?, image_height = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(img.server_path, img.image_hash, img.width, img.height, now, note_id, req.user.id);

  res.json({ ok: true, revision: newRev });
});

// ===== DELETE /:imageId — 删除图片 =====
router.delete('/:imageId', (req, res) => {
  const img = db.prepare('SELECT * FROM note_images WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(req.params.imageId, req.user.id);
  if (!img) return res.status(404).json({ ok: false, error: '图片不存在' });

  const now = new Date().toISOString();
  db.prepare('UPDATE note_images SET deleted_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(now, now, req.params.imageId, req.user.id);

  const filePath = path.join(NOTE_IMAGES_DIR, img.server_path);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch {}
  }

  res.json({ ok: true, deleted: true });
});

// ===== POST /sync-pull — 增量拉取图片元数据 =====
router.post('/sync-pull', (req, res) => {
  const { device_id, since_revision } = req.body;
  if (!device_id) return res.status(400).json({ ok: false, error: 'device_id 必填' });

  const sinceRev = parseInt(since_revision) || 0;

  const images = db.prepare(
    'SELECT * FROM note_images WHERE user_id = ? AND revision > ? AND deleted_at IS NULL ORDER BY revision ASC LIMIT 200'
  ).all(req.user.id, sinceRev);

  const deletedRows = db.prepare(
    'SELECT id, revision FROM note_images WHERE user_id = ? AND revision > ? AND deleted_at IS NOT NULL ORDER BY revision ASC LIMIT 200'
  ).all(req.user.id, sinceRev);

  const maxRev = db.prepare('SELECT MAX(revision) as m FROM note_images WHERE user_id = ?').get(req.user.id);

  res.json({
    ok: true,
    images: images.map(i => ({
      id: i.id, note_id: i.note_id, filename: i.filename,
      server_path: i.server_path, file_size: i.file_size,
      mime_type: i.mime_type, image_hash: i.image_hash,
      width: i.width, height: i.height, revision: i.revision,
      download_url: `/memora/sync/notes/images/${i.id}/download`,
      created_at: i.created_at, updated_at: i.updated_at
    })),
    deleted_ids: deletedRows.map(d => ({ id: d.id, revision: d.revision })),
    count: images.length,
    max_revision: maxRev?.m || 0
  });
});

module.exports = router;
