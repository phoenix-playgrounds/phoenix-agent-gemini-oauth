import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const MODEL_FILE = path.join(DATA_DIR, "model.json");

export class ModelStore {
    constructor() {
        this._ensureDataDir();
    }

    get() {
        if (!fs.existsSync(MODEL_FILE)) return "";
        try {
            const data = JSON.parse(fs.readFileSync(MODEL_FILE, "utf8"));
            return data.model || "";
        } catch {
            return "";
        }
    }

    set(model) {
        const value = (model || "").trim();
        fs.writeFileSync(MODEL_FILE, JSON.stringify({ model: value }, null, 2));
        return value;
    }

    _ensureDataDir() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    }
}
