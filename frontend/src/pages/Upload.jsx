import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload as UploadIcon, CheckCircle, XCircle, FileText, Loader } from "lucide-react";
import { uploadFile } from "../api/client";

const STATUS = { idle: "idle", uploading: "uploading", done: "done", error: "error" };

function FileItem({ file, onRemove }) {
  const [status, setStatus] = useState(STATUS.idle);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const handleUpload = async () => {
    setStatus(STATUS.uploading);
    setErr(null);
    try {
      const res = await uploadFile(file, setProgress);
      setResult(res.data);
      setStatus(STATUS.done);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message || "Erro desconhecido");
      setStatus(STATUS.error);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-3">
        <FileText size={18} className="text-blue-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{file.name}</p>
          <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
        </div>
        <div className="flex gap-2">
          {status === STATUS.idle && (
            <>
              <button onClick={handleUpload} className="btn-primary text-xs py-1.5 px-3">
                Enviar
              </button>
              <button onClick={() => onRemove(file)} className="btn-secondary text-xs py-1.5 px-3">
                Remover
              </button>
            </>
          )}
          {status === STATUS.uploading && <Loader size={18} className="text-blue-400 animate-spin" />}
          {status === STATUS.done && <CheckCircle size={18} className="text-emerald-400" />}
          {status === STATUS.error && <XCircle size={18} className="text-red-400" />}
        </div>
      </div>

      {status === STATUS.uploading && (
        <div className="w-full bg-gray-700 rounded-full h-1.5">
          <div
            className="bg-blue-500 h-1.5 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {status === STATUS.done && result && (
        <div className="text-xs space-y-1 text-gray-400">
          <p><span className="text-gray-300">Parser:</span> {result.parser_used}</p>
          <p><span className="text-gray-300">Instituição:</span> {result.institution}</p>
          <p><span className="text-gray-300">Data:</span> {result.snapshot_date}</p>
          <p>
            <span className="text-emerald-400">{result.records_inserted} inseridos</span>
            {result.records_updated > 0 && (
              <span className="text-blue-400 ml-2">{result.records_updated} atualizados</span>
            )}
          </p>
          {result.errors?.length > 0 && (
            <ul className="text-red-400 mt-1 space-y-0.5">
              {result.errors.slice(0, 5).map((e, i) => <li key={i}>• {e}</li>)}
            </ul>
          )}
        </div>
      )}

      {status === STATUS.error && err && (
        <p className="text-xs text-red-400">{err}</p>
      )}
    </div>
  );
}

export default function Upload() {
  const [files, setFiles] = useState([]);

  const onDrop = useCallback((accepted) => {
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...accepted.filter((f) => !names.has(f.name))];
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    multiple: true,
  });

  const remove = (file) => setFiles((prev) => prev.filter((f) => f !== file));

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-bold text-white">Importar Arquivos</h2>
        <p className="text-gray-500 text-sm">Suporte: Regions XLSX/PDF · XP XLSX · Inter PDF</p>
      </div>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          isDragActive
            ? "border-blue-500 bg-blue-500/10"
            : "border-gray-700 hover:border-gray-600 hover:bg-gray-800/40"
        }`}
      >
        <input {...getInputProps()} />
        <UploadIcon size={32} className="mx-auto mb-3 text-gray-500" />
        <p className="text-gray-300 font-medium">
          {isDragActive ? "Solte os arquivos aqui" : "Arraste arquivos ou clique para selecionar"}
        </p>
        <p className="text-gray-500 text-sm mt-1">.xlsx · .xls · .pdf</p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400 font-medium">{files.length} arquivo(s)</p>
          {files.map((f) => (
            <FileItem key={f.name} file={f} onRemove={remove} />
          ))}
        </div>
      )}
    </div>
  );
}
