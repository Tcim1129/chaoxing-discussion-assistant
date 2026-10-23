"""Package only extension runtime files; never include browser data or local exports."""
from pathlib import Path
import json, zipfile, hashlib

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'extension'
FILES=['manifest.json','README.md','icon.svg','background.js','content-script.js',
       'options.html','options.css','options.js','workbench.html','workbench.css','workbench.js',
       'workbench-classroom.js','workbench-grading.js','analysis/engine.js','analysis/agent.js',
       'analysis/provider.js','analysis/classroom.js','analysis/grading.js','analysis/workflow.js',
       'analysis/collection-scope.js']
FILES += ['LICENSE', 'THIRD_PARTY_NOTICES.md']
def source_file(name):
    return (ROOT if name in {'LICENSE', 'THIRD_PARTY_NOTICES.md'} else SOURCE)/name
version=json.loads((SOURCE/'manifest.json').read_text(encoding='utf-8'))['version']
destination=ROOT/'dist'
destination.mkdir(exist_ok=True)
archive=destination/f'chaoxing-discussion-assistant-{version}.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for name in FILES:
        z.write(source_file(name),name)
with zipfile.ZipFile(archive) as z:
    assert sorted(z.namelist())==sorted(FILES) and z.testzip() is None
    assert all(z.read(name)==source_file(name).read_bytes() for name in FILES)
sha=hashlib.sha256(archive.read_bytes()).hexdigest()
digest=destination/'SHA256SUMS'
digest.write_text(f'{sha}  {archive.name}\n',encoding='utf-8')
print(f'{archive.relative_to(ROOT)}\nSHA-256 {sha}')
