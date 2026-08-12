import {BarChart,Bar , XAxis,YAxis , Tooltip, CartesianGrid} from "recharts";
function Charts({players,bowlers}){
//transforming data for strike rate
const strikeRateData = players.map( p => ({

player:p.name,
sr : p.balls > 0 ? Number(((p.runs/p.balls)*100).toFixed(2)) : 0
}));

//transform data for economy
const economyData = bowlers.map(b => ({
bowler: b.name,
eco : b.overs > 0 ? Number((b.runs/b.overs).toFixed(2)) : 0
}));
return(

<div className = "charts-container">
<div>
<h3>Runs Scored</h3>
<BarChart width={300} height={250} data = {players}>
<CartesianGrid strokeDasharray="3 3" />
<XAxis dataKey = "name" />
<YAxis />
<Tooltip />
<Bar dataKey = "runs" />
</BarChart>
</div>
 <div>
        <h3>Strike Rate</h3>
        <BarChart width={300} height={250} data={strikeRateData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="player" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="sr" />
        </BarChart>
      </div>
 {/* 🎯 Economy Chart */}
      <div>
        <h3>Bowling Economy</h3>
        <BarChart width={300} height={250} data={economyData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="bowler" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="eco" />
        </BarChart>
      </div>

    </div>

);
}
export default Charts;