import { useState, type FormEvent } from 'react';
import {
  LEAF_TEXTURES,
  PHENOLOGY_STAGES,
  type GameCommand,
  type LeafTexture,
  type PhenologyStage,
  type SiteSnapshot,
  type SpeciesSnapshot
} from '@shanhai/contracts';

type ObservationValues = Extract<GameCommand, { type: 'OBSERVE_PLANT' }>['values'];

const STAGE_LABELS: Record<PhenologyStage, string> = {
  leafing: '展叶',
  budding: '现蕾',
  early_bloom: '初花',
  full_bloom: '盛花',
  late_bloom: '末花',
  fruiting: '结果',
  leaf_color: '叶变色',
  leaf_fall: '落叶',
  dormant: '休眠'
};

const TEXTURE_LABELS: Record<LeafTexture, string> = {
  smooth: '光滑',
  leathery: '革质',
  rough: '粗糙',
  pubescent: '绒毛',
  waxy: '蜡质',
  needle: '针状',
  compound: '复叶'
};

export function ObservationForm({
  species,
  site,
  busy,
  onSubmit
}: {
  species: SpeciesSnapshot;
  site: SiteSnapshot;
  busy: boolean;
  onSubmit: (values: ObservationValues) => Promise<boolean>;
}) {
  const [phenology, setPhenology] = useState<PhenologyStage>('leafing');
  const [leafTexture, setLeafTexture] = useState<LeafTexture>('smooth');
  const [dominantColor, setDominantColor] = useState(species.phenology.dominantColor);
  const [temperatureC, setTemperatureC] = useState(round(site.environment.temperatureC));
  const [humidity, setHumidity] = useState(Math.round(site.environment.humidity));
  const [soilMoisture, setSoilMoisture] = useState(Math.round(site.environment.soilMoisture));
  const [lightLux, setLightLux] = useState(Math.round(site.environment.lightLux));
  const [note, setNote] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await onSubmit({
      phenology,
      leafTexture,
      dominantColor,
      temperatureC: Number(temperatureC),
      humidity: Number(humidity),
      soilMoisture: Number(soilMoisture),
      lightLux: Number(lightLux),
      note
    });
    if (saved) {
      setNote('');
    }
  };

  return (
    <form className="field-form" onSubmit={submit}>
      <div className="form-grid two-columns">
        <label>
          <span>物候阶段</span>
          <select value={phenology} onChange={(event) => setPhenology(event.target.value as PhenologyStage)}>
            {PHENOLOGY_STAGES.map((stage) => (
              <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>叶片纹理</span>
          <select value={leafTexture} onChange={(event) => setLeafTexture(event.target.value as LeafTexture)}>
            {LEAF_TEXTURES.map((texture) => (
              <option key={texture} value={texture}>{TEXTURE_LABELS[texture]}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        <span>可见主色</span>
        <span className="color-input-row">
          <input type="color" value={dominantColor} onChange={(event) => setDominantColor(event.target.value)} />
          <code>{dominantColor}</code>
        </span>
      </label>
      <div className="form-grid four-columns">
        <NumberField label="温度 °C" value={temperatureC} onChange={setTemperatureC} step={0.1} />
        <NumberField label="湿度 %" value={humidity} onChange={setHumidity} />
        <NumberField label="土壤 %" value={soilMoisture} onChange={setSoilMoisture} />
        <NumberField label="光照 lux" value={lightLux} onChange={setLightLux} step={100} />
      </div>
      <label>
        <span>现场备注</span>
        <textarea value={note} maxLength={500} rows={3} placeholder="记录风向、虫媒、叶片朝向等现场细节" onChange={(event) => setNote(event.target.value)} />
      </label>
      <button className="button button-primary full-width" type="submit" disabled={busy}>
        {busy ? '正在写入笔记…' : `记录 ${species.name}`}
      </button>
    </form>
  );
}

export function EnvironmentForm({
  site,
  busy,
  onSubmit
}: {
  site: SiteSnapshot;
  busy: boolean;
  onSubmit: (values: Extract<GameCommand, { type: 'RECORD_ENVIRONMENT' }>['values']) => Promise<boolean>;
}) {
  const [temperatureC, setTemperatureC] = useState(round(site.environment.temperatureC));
  const [humidity, setHumidity] = useState(Math.round(site.environment.humidity));
  const [soilMoisture, setSoilMoisture] = useState(Math.round(site.environment.soilMoisture));
  const [lightLux, setLightLux] = useState(Math.round(site.environment.lightLux));
  const [note, setNote] = useState('');

  return (
    <form
      className="environment-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const saved = await onSubmit({
          temperatureC: Number(temperatureC),
          humidity: Number(humidity),
          soilMoisture: Number(soilMoisture),
          lightLux: Number(lightLux),
          note
        });
        if (saved) {
          setNote('');
        }
      }}
    >
      <div className="form-grid four-columns">
        <NumberField label="温度 °C" value={temperatureC} onChange={setTemperatureC} step={0.1} />
        <NumberField label="湿度 %" value={humidity} onChange={setHumidity} />
        <NumberField label="土壤 %" value={soilMoisture} onChange={setSoilMoisture} />
        <NumberField label="光照 lux" value={lightLux} onChange={setLightLux} step={100} />
      </div>
      <label>
        <span>环境备注</span>
        <input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="例如：林缘西侧有阵风" />
      </label>
      <button className="button button-secondary" type="submit" disabled={busy}>记录当前环境</button>
    </form>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label>
      <span>{label}</span>
      <input type="number" value={value} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
