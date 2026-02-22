import fs from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");

export class MessageStore {
    constructor() {
        this._ensureDataDir();
        this._messages = this._load();
    }

    all() {
        return this._messages;
    }

    add(role, body) {
        const message = {
            id: crypto.randomUUID(),
            role,
            body,
            created_at: new Date().toISOString()
        };
        this._messages.push(message);
        this._save();
        return message;
    }

    clear() {
        this._messages = [];
        this._save();
    }

    _ensureDataDir() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    }

    _load() {
        if (!fs.existsSync(MESSAGES_FILE)) return [];
        try {
            return JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf8"));
        } catch {
            return [];
        }
    }

    _save() {
        fs.writeFileSync(MESSAGES_FILE, JSON.stringify(this._messages, null, 2));
    }
}
