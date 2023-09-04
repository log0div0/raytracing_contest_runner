const fs = require('fs').promises;
const _fs = require('fs');
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const args = require('args-parser')(process.argv);
const { execSync, spawnSync } = require("child_process");
const pretty = require('pretty-time');

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const SPREADSHEET_ID = "1k7h9KQ1si7DteOdsXfPLhLCJ6n7bmrHz2ZaJNL8kWLY";
const GDRIVE_FOLDER_ID = "18z2d1Wu8kheNawx6D6BsTG3os5dAuR_R";
const ROUND_ID = "Round 0";
const TMP_DIR = "C:\\Users\\log0div0\\work\\tmp";
const GLTF_PATH = "C:\\Users\\log0div0\\work\\zig_raytracing_contest\\models\\Duck.glb";
const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const TIMEOUT = hour;

async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

async function getRowID(auth, author) {
  const sheets = google.sheets({version: 'v4', auth});
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ROUND_ID}!A1:A`,
  });
  for (const [i, row] of res.data.values.entries()) {
    if (row[0] == author) {
      return i + 1;
    }
  }
  throw `couldn't find ${author}`;
}

async function findRoundFolder(auth) {
  const service = google.drive({version: 'v3', auth});
  const res = await service.files.list({
    q: `name='${ROUND_ID}' and '${GDRIVE_FOLDER_ID}' in parents`,
    fields: 'files(id, name)',
    spaces: "drive",
  });
  return res.data.files[0].id;
}

async function findFile(auth, file_name, folder) {
  const service = google.drive({version: 'v3', auth});
  const res = await service.files.list({
    q: `name='${file_name}' and '${folder}' in parents`,
    fields: 'files(id, name)',
    spaces: "drive",
  });
  return res.data.files;
}

async function deleteFile(auth, file_id) {
  const service = google.drive({version: 'v3', auth});
  const res = await service.files.delete({
    fileId: file_id,
  });
}

async function uploadFile(auth, file_name, src_file_path, folder, mime) {
  const existing_files = await findFile(auth, file_name, folder);
  for (const file of existing_files) {
    console.log(`deleting file ${file_name}`);
    await deleteFile(auth, file.id);
  }
  if (!_fs.existsSync(src_file_path)) {
    console.log(`${src_file_path} does not exist, skip file uploading`);
    return
  }
  console.log(`uploading file ${file_name} ...`);
  const service = google.drive({version: 'v3', auth});
  const requestBody = {
    name: `${file_name}`,
    parents: [folder],
    fields: 'id',
  };
  const media = {
    mimeType: mime,
    body: _fs.createReadStream(src_file_path),
  };
  const file = await service.files.create({
    requestBody,
    media: media,
  });
  return file.data.id;
}

async function findExePath(dir) {
  const files = await fs.readdir(dir);
  for (const file of files) {
    if (path.extname(file) == '.exe') {
      return path.join(dir, file);
    }
  }
  throw `couldn't find exe file in ${dir}`
}

async function shareFile(auth, file_id) {
  const service = google.drive({version: 'v3', auth});
  const result = await service.permissions.create({
    resource: {
      type: 'anyone',
      role: 'reader',
    },
    fileId: file_id,
  });
}

async function updateValues(auth, row_id, time, img_val, stdout) {
  console.log("updating cells in the table ...");
  const service = google.sheets({version: 'v4', auth});
  let values = [
    [
      time, img_val, stdout
    ],
    // Additional rows ...
  ];
  const result = await service.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `B${row_id}:D${row_id}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values,
    },
  });
}

async function readFile(path) {
  const f = await fs.open(path, 'r');
  const result = await f.readFile({encoding: 'utf8'});
  await f.close();
  return result;
}

async function main() {
  if (!args.author) {
    throw "author is not specified";
  }
  if (!args.zip) {
    throw "zip path is not specified";
  }

  const auth = await authorize();
  console.log("successful auth");

  const row_id = await getRowID(auth, args.author);
  console.log(`row_id = ${row_id}`);

  const round_folder = await findRoundFolder(auth);
  console.log(`round_folder = ${round_folder}`)

  const tmp_unpacked_dir = path.join(TMP_DIR, "zip_unpacked");
  const out_png = path.join(TMP_DIR, "output.png");
  const out_txt = path.join(TMP_DIR, "output.txt");

  execSync(`rmdir ${TMP_DIR} /s /q`)
  execSync(`mkdir ${tmp_unpacked_dir}`)
  execSync(`tar -xf ${args.zip} -C ${tmp_unpacked_dir}`);
  const exe = await findExePath(tmp_unpacked_dir);
  console.log(`exe = ${exe}`);

  const txt_file = await fs.open(out_txt, 'w');
  const start = process.hrtime();
  const res = spawnSync(exe, ["--in", GLTF_PATH, "--out", out_png, "--height", 1080], {
    stdio: [null, txt_file, txt_file],
    cwd: tmp_unpacked_dir,
    timeout: TIMEOUT,
  });
  console.log(res);
  const duration = process.hrtime(start);
  await txt_file.close();

  const time = pretty(duration, 'ms');
  console.log(`time = ${time}`);
  var stdout = await readFile(out_txt)
  console.log(`${stdout}`);

  const img_id = await uploadFile(auth, `${args.author}.png`, out_png, round_folder, 'image/png');
  const zip_id = await uploadFile(auth, `${args.author}.zip`, args.zip, round_folder, 'application/zip');
  const txt_id = await uploadFile(auth, `${args.author}.txt`, out_txt, round_folder, 'text/plain');

  var img_val = null;
  if (img_id) {
    await shareFile(auth, img_id);
    const img_uri = `https://drive.google.com/uc?export=download&id=${img_id}`
    console.log(`img_uri = ${img_uri}`);
    img_val = `=image("${img_uri}")`
  } else {
    img_val = `Program produces no output image. Exit code = 0x${res.status.toString(16)}`
  }

  if (stdout.split(/\r\n|\r|\n/).length > 35) {
    stdout = `https://drive.google.com/file/d/${txt_id}/view?usp=drive_link`;
  }

  await updateValues(auth, row_id, time, img_val, stdout);

  console.log("DONE!");
}

main().catch(console.error)
