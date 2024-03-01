const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const core = require('@actions/core');

function generateFolder() {
    const randomHash = crypto
    .createHash('md5')
    .update((new Date()).getTime().toString())
    .digest('hex');
    return `package-build-${randomHash}`;
}

function compressFilesToZip(zipFilePath, fileMapping) {
    return new Promise((resolve, reject) => {
      // Create the folder for output if it does not exist
        const outputDir = path.dirname(zipFilePath);
        if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, {recursive: true});
      }
      // create a write stream for the output zip file
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
      });
  
      // listen for all archive data to be written
      output.on('close', function() {
        console.log(archive.pointer() + ' total bytes');
        console.log('archiver has been finalized and the output file descriptor has closed.');
        resolve();
      });
  
      // handle errors
      output.on('error', reject);
  
      // pipe archive data to the file
      archive.pipe(output);
  
      // append files to the archive
      Object.keys(fileMapping).forEach(filePath => {
        const fileName = fileMapping[filePath]; // get the file name
        archive.append(fs.createReadStream(filePath), { name: fileName });
      });
  
      // finalize the archive
      archive.finalize();
    });
}

function listFiles(dir) {
    const out = [];
    fs.readdirSync(dir).forEach(file => {
        if (fs.statSync(path.join(dir, file)).isDirectory()) {
            out.push(...listFiles(path.join(dir, file)));
        }
        else {
            out.push(path.join(dir, file));
        }
    });
    return out;
}

function getFilesAndZipPaths(dir) {
    const out = {};
    files = listFiles(dir);
    files.forEach(file => {
        out[file] = file.replace(dir, '');
    });
    return out;
}

function addSha1ForFiles(files) {
    files.forEach(file => {
        const fileContent = fs.readFileSync(file);
        const sha1 = crypto.createHash('sha1').update(fileContent).digest('hex');
        fs.writeFileSync(`${file}.sha1`, sha1);
    });
}

const main = async (args) => {
    args = args.slice(2);
    const buildDir = generateFolder();
    if (!fs.existsSync(buildDir)) {
        fs.mkdirSync(buildDir);
    } else {
        throw new Error(`Folder ${buildDir} already exists`);
    }

    for (let distPath of args) {
        absolutePath = path.resolve(distPath);
        if (!fs.existsSync(absolutePath)) {
            console.log(`Path ${absolutePath} does not exist`);
            continue;
        }

        const pluginJson = require(`${absolutePath}/plugin.json`);
        const { id: pluginId, info: { version: pluginVersion }} = pluginJson;

        const copiedPath = path.join(process.cwd(), buildDir, pluginId);
        fs.cpSync(absolutePath, copiedPath, {recursive: true});

        const filesWithZipPaths = getFilesAndZipPaths(copiedPath);
        await compressFilesToZip(`${buildDir}/${pluginVersion}/${pluginId}-${pluginVersion}.zip`, filesWithZipPaths);
        // Take filesWithZipPaths and split them into goBuildFiles and nonGoBuildFiles
        const goBuildFiles = {};
        const nonGoBuildFiles = {};
        Object.keys(filesWithZipPaths).forEach(
            (filePath) => {
                const zipPath = filesWithZipPaths[filePath];
                const fileName = filePath.split("/").pop();
                if (fileName.startsWith("gpx")) {
                    goBuildFiles[filePath] = zipPath;
                } else {
                    nonGoBuildFiles[filePath] = zipPath;
                }
            }
        );

        // Noop if there are no go build files
        // Otherwise, compress each go build file along with all non-go files into a separate zip
        for (let [filePath, zipPath] of Object.entries(goBuildFiles)) {
            const fileName = filePath.split("/").pop().replace(/\.exe$/, "");
            const [goos, goarch] = fileName.split("_").slice(2);
            const outputName = `${pluginId}-${pluginVersion}.${goos}_${goarch}.zip`;
            const zipDestination = `${buildDir}/${pluginVersion}/${goos}/${outputName}`;
            fs.mkdirSync(path.dirname(zipDestination), {recursive: true});
            await compressFilesToZip(zipDestination, {[filePath]: zipPath, ...nonGoBuildFiles});
        }

        // Copy all of the files from buildDir/pluginVersion to buildDir/latest
        // Removes pluginVersion from their path and filename and replaces it with latest
        const latestPath = `${buildDir}/latest`;
        const currentVersionPath = `${buildDir}/${pluginVersion}`;
        fs.mkdirSync(latestPath, {recursive: true});
        const filesToCopy = listFiles(currentVersionPath);
        filesToCopy.forEach((filePath) => {
            const newFileName = filePath.split("/").pop().replace(`${pluginVersion}`, 'latest');
            const newFileSubdirectory = filePath.replace(currentVersionPath, latestPath).split("/").slice(0, -1).join("/");
            const newFilePath = `${newFileSubdirectory}/${newFileName}`;
            fs.mkdirSync(path.dirname(newFilePath), {recursive: true});
            fs.cpSync(filePath, newFilePath);
        });

        // Sign all zip files with sha1
        const zipFiles = listFiles(currentVersionPath).filter((file) => file.endsWith(".zip"));
        addSha1ForFiles(zipFiles);
        const latestZipFiles = listFiles(latestPath).filter((file) => file.endsWith(".zip"));
        addSha1ForFiles(latestZipFiles);

        // Move buildDir/latest and buildDir/pluginVersion to rootDir/__to-upload__
        const toUploadPath = path.join(process.cwd(), "__to-upload__");
        fs.mkdirSync(toUploadPath, {recursive: true});
        fs.cpSync(latestPath, path.join(toUploadPath, 'latest'), {recursive: true});
        fs.cpSync(currentVersionPath, path.join(toUploadPath, pluginVersion), {recursive: true});

        // Clean up after yourself
        fs.rmdirSync(buildDir, {recursive: true});

        core.setOutput("to-upload", toUploadPath)
    }
}

main(core.getInput('dist-paths', { required: true }).split(' '));