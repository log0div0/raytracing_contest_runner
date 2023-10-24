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
const SPREADSHEET_ID = "1wz3JtUW83_rPdbTjTbjK2NLrk77NiNBL4P3-_k5L7-8";
const GDRIVE_FOLDER_ID = "18z2d1Wu8kheNawx6D6BsTG3os5dAuR_R";
const ROUND_ID = "Round 1";
const TMP_DIR = "C:\\Users\\log0div0\\work\\tmp";
const GLTF_PATH = "C:\\Users\\log0div0\\work\\raytracing_contest_models\\Round1\\high-res.glb";
const TESTS_PATH = "C:\\Users\\log0div0\\work\\raytracing_contest_models\\Tests"
const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const TIMEOUT = hour;

const CAMERAS = [
  "Camera 1",
  "Camera 2",
  "Camera 3",
  "Camera 4",
];

const TESTS = [
  "AlphaBlendModeTest",
  "TextureEncodingTest",
  "TextureLinearInterpolationTest",
  "TextureTransformTest",
];

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
  if (files.length == 1) {
    const new_path = path.join(dir, files[0]);
    const stat = await fs.stat(new_path);
    if (stat.isDirectory()) {
      return findExePath(new_path)
    }
  }
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

async function updateValues(auth, row_id, time, img_val, stdout, author) {
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
    range: `${author}!B${row_id}:D${row_id}`,
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

async function checkSheetExists(auth, author) {
  console.log(`looking for ${author}`)
  const sheets = google.sheets({version: 'v4', auth});
  const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });
  for (const [i, row] of res.data.sheets.entries()) {
    if (row.properties.title == author) {
      return i + 1;
    }
  }
  throw `couldn't find ${author}`;
}

async function findRoundFolder(auth) {
  const service = google.drive({version: 'v3', auth});
  const res = await service.files.list({
    q: `name='${ROUND_ID}' and '${GDRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder'`,
    fields: 'files(id, name)',
    spaces: "drive",
  });
  return res.data.files[0].id;
}

async function findAuthorFolder(auth, author, round_folder) {
  const service = google.drive({version: 'v3', auth});
  const res = await service.files.list({
    q: `name='${author}' and '${round_folder}' in parents and mimeType='application/vnd.google-apps.folder'`,
    fields: 'files(id, name)',
    spaces: "drive",
  });
  if (res.data.files.length) {
    return res.data.files[0].id;
  }
}

async function getAuthorFolder(auth, author, round_folder) {
  const id = await findAuthorFolder(auth, author, round_folder);
  if (id) {
    return id;
  }
  console.log(`creating author folder`);
  const service = google.drive({version: 'v3', auth});
  const file = await service.files.create({
    resource: {
      mimeType: "application/vnd.google-apps.folder",
      name: author,
      parents: [round_folder],
    },
    fields: 'id',
  });
  return file.data.id;
}

async function getTestRowID(auth, author, test_name) {
  const sheets = google.sheets({version: 'v4', auth});
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${author}!A1:A`,
  });
  for (const [i, row] of res.data.values.entries()) {
    if (row[0] == test_name) {
      return i + 1;
    }
  }
  throw `couldn't find ${test_name}`;
}

async function execTest(auth, camera_name, gltf_path, test_name, author_folder, author)
{
  const row_id = await getTestRowID(auth, author, test_name)
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
  const res = spawnSync(exe, [
    "--in", gltf_path,
    "--out", out_png,
    "--height", 1080,
    "--camera", camera_name,
    "--ambient", "FFFFFF",
  ], {
    stdio: [null, txt_file, txt_file],
    cwd: path.dirname(exe),
    timeout: TIMEOUT,
  });
  console.log(`status = ${res.status}`);
  const duration = process.hrtime(start);
  await txt_file.close();

  const time = pretty(duration, 'ms');
  console.log(`time = ${time}`);
  var stdout = await readFile(out_txt)
  // console.log(`${stdout}`);

  const img_id = await uploadFile(auth, `${test_name}.png`, out_png, author_folder, 'image/png');
  const txt_id = await uploadFile(auth, `${test_name}.txt`, out_txt, author_folder, 'text/plain');

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

  await updateValues(auth, row_id, time, img_val, stdout, author);
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

  const sheet_num = await checkSheetExists(auth, args.author);
  console.log(`sheet_num = ${sheet_num}`);

  const round_folder = await findRoundFolder(auth);
  console.log(`round_folder = ${round_folder}`)

  const author_folder = await getAuthorFolder(auth, args.author, round_folder);
  console.log(`author_folder = ${author_folder}`)

  for (const test of TESTS) {
    const test_path = `${TESTS_PATH}\\${test}\\${test}.gltf`;
    await execTest(auth, "Camera.001", test_path, test, author_folder, args.author);
  }

  for (const camera of CAMERAS) {
    await execTest(auth, camera, GLTF_PATH, camera, author_folder, args.author);
  }

  const zip_id = await uploadFile(auth, `app.zip`, args.zip, author_folder, 'application/zip');

  console.log("DONE!");
}

main().catch(console.error)
