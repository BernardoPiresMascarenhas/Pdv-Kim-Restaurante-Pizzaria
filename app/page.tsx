"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import {
  IconSearch, IconPlus, IconTrash, IconPrinter, IconLock, IconLogout,
  IconSettings, IconArrowLeft, IconRotateLeft, IconX, IconCheck, IconBell,
  IconReceipt, IconMenuBook, IconCash, IconCard, IconPix, IconTable,
} from "@/components/icons";

export interface Produto {
  id: number;
  nome: string;
  preco: number;
  categoria: string;
  disponivel?: boolean;
  /** FALSE = não imprime ficha na cozinha (bebidas, itens prontos). */
  vai_para_cozinha?: boolean;
  /** TRUE = abre o configurador de tamanho / sabores. */
  eh_pizza?: boolean;
  /** TRUE = abre o configurador de suco meio a meio (2 sabores). */
  eh_suco_misto?: boolean;
  /** TRUE = pode ser escolhido como metade de um suco misto. */
  eh_sabor_suco?: boolean;
}

export interface PizzaTamanho {
  id: number;
  nome: string;
  fatias: string | null;
  preco: number;
  ordem: number;
}

/** Item que o garçom montou mas ainda NÃO confirmou.
 *  Vive só na memória: nada entra na conta nem na cozinha antes do
 *  "Confirmar pedido". */
interface ItemRascunho {
  tempId: string;
  produto_id: number;
  descricao: string;
  /** Anotação do garçom. Só pizza usa, e sai destacada na ficha. */
  observacao: string | null;
  valor_unitario: number;
  vai_para_cozinha: boolean;
}

/** Máximo de sabores extras além do primeiro (4 sabores no total). */
const MAX_SABORES_EXTRA = 3;

export default function PDV() {


  const [perfilUsuario, setPerfilUsuario] = useState<'admin' | 'garcom' | null>(null); 
  const [senhaDigitada, setSenhaDigitada] = useState("");
  const [erroLogin, setErroLogin] = useState("");


  const [carrinhoMobileAberto, setCarrinhoMobileAberto] = useState(false);
// Controle para exibir ou esconder o painel de estoque
  const [mostrarEstoque, setMostrarEstoque] = useState(false);

  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [comandas, setComandas] = useState<any[]>([]);
  const [comandaAbertaId, setComandaAbertaId] = useState<number | null>(null);
  const [buscaComanda, setBuscaComanda] = useState("");
  const [buscaProduto, setBuscaProduto] = useState("");
  const [formaPagamento, setFormaPagamento] = useState<string>("Pendente");
  const [carregando, setCarregando] = useState(true);
  const [categoriaSelecionada, setCategoriaSelecionada] = useState<string>("Todas");// Estado para a impressão da cozinha
  const [fichaCozinha, setFichaCozinha] = useState<{mesa: string, item: string, qtd: number, hora: string, obs?: string | null} | null>(null);

  // Tamanhos de pizza (preço vem daqui, não do sabor)
  const [tamanhosPizza, setTamanhosPizza] = useState<PizzaTamanho[]>([]);

  // Rascunho: o pedido que o garçom está montando, antes de confirmar
  const [rascunho, setRascunho] = useState<ItemRascunho[]>([]);
  const [enviandoPedido, setEnviandoPedido] = useState(false);
  const [fechandoConta, setFechandoConta] = useState(false);

  // Configurador de pizza. `sabor1` é o sabor em que o garçom tocou.
  const [configPizza, setConfigPizza] = useState<{
    sabor1: Produto;
    tamanhoId: number | null;
    varios: boolean;          // "mais de um sabor"
    saboresExtra: number[];   // ids dos sabores adicionais (até 3)
    observacao: string;
  } | null>(null);

  // Configurador de suco meio a meio: exatamente 2 sabores
  const [configSuco, setConfigSuco] = useState<{
    produto: Produto;
    sabores: number[];
  } | null>(null);
  // Fila de pedidos (inicia buscando do localStorage, se houver)
  const [pedidosPendentes, setPedidosPendentes] = useState<any[]>(() => {
    // Evita erro no Next.js durante a renderização no servidor
    if (typeof window !== 'undefined') {
      const pedidosSalvos = localStorage.getItem('pedidosPendentesKim');
      if (pedidosSalvos) {
        return JSON.parse(pedidosSalvos);
      }
    }
    return []; // Se não tiver nada salvo, começa vazio
  });

  // Salva os pedidos pendentes no LocalStorage sempre que a lista mudar
  useEffect(() => {
    localStorage.setItem('pedidosPendentesKim', JSON.stringify(pedidosPendentes));
  }, [pedidosPendentes]);

  useEffect(() => {
    // Se não for o dono, nem tenta escutar o banco
    if (perfilUsuario !== 'admin') return;

    const canalCozinha = supabase
      .channel('novos-pedidos-cozinha')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'itens_comanda' },
        async (payload) => {
          const novoItem = payload.new;

          const { data: produto } = await supabase
            .from('produtos')
            .select('nome, vai_para_cozinha')
            .eq('id', novoItem.produto_id)
            .single();

          // FILTRO DA COZINHA: bebida e item pronto não geram ficha.
          // Eles continuam na comanda da mesa, só não vão para o forno.
          if (produto && produto.vai_para_cozinha === false) return;

          const { data: comanda } = await supabase
            .from('comandas')
            .select('nome')
            .eq('id', novoItem.comanda_id)
            .single();

          const pedidoCompleto = {
            id: novoItem.id, // ID do item_comanda
            mesa: comanda?.nome || 'MESA ?',
            // `descricao` já vem pronta com tamanho e sabores
            item: novoItem.descricao || produto?.nome || 'ITEM ?',
            obs: novoItem.observacao || null,
            qtd: novoItem.quantidade || 1
          };

          // Toca um bipe sonoro (opcional, mas legal para o caixa ouvir)
          const audio = new Audio('https://www.soundjay.com/buttons/beep-07.wav');
          audio.play().catch(() => {}); // catch para evitar erro se o navegador bloquear autoplay

          // Adiciona na fila de pendentes na tela do dono
          setPedidosPendentes((prev) => [...prev, pedidoCompleto]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canalCozinha);
    };
  }, [perfilUsuario]);

  // Fica escutando a tabela de Comandas (Mesas) em tempo real
  useEffect(() => {
    if (!perfilUsuario) return;

    const canalMesas = supabase
      .channel('mudancas-mesas')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comandas' },
        () => {
          // Quando o garçom criar uma mesa, o banco avisa o sistema do dono
          // e esta função abaixo atualiza a tela automaticamente
          carregarDados(); 
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canalMesas);
    };
  }, [perfilUsuario]);

  // Escuta mudanças no estoque (produtos) em tempo real para TODOS os usuários
  useEffect(() => {
    // Esse canal fica aberto para o Admin e para o Garçom
    const canalProdutos = supabase
      .channel('mudancas-produtos')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'produtos' },
        (payload) => {
          const produtoAtualizado = payload.new as Produto;

          // Atualiza a lista de produtos na tela instantaneamente, sem recarregar a página
          setProdutos((prevProdutos) =>
            prevProdutos.map((p) =>
              p.id === produtoAtualizado.id 
                ? { ...p, disponivel: produtoAtualizado.disponivel } 
                : p
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canalProdutos);
    };
  }, []);

  const imprimirFichaCozinha = (nomeMesa: string, nomeItem: string, quantidade: number, obs?: string | null) => {
    // Pega a hora exata do pedido
    const horaAtual = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    setFichaCozinha({ mesa: nomeMesa, item: nomeItem, qtd: quantidade, hora: horaAtual, obs });

    // Dá 100 milissegundos pro React "desenhar" a ficha escondida antes de imprimir
    setTimeout(() => {
      window.print();
      // Limpa a ficha depois de mandar pra impressora (opcional)
      setFichaCozinha(null);
    }, 100);
  };

  useEffect(() => {
    if (perfilUsuario !== null) {
      carregarDados();
    }
  }, [perfilUsuario]); 

  const carregarDados = async () => {
    setCarregando(true);
    const { data: dbProdutos } = await supabase.from('produtos').select('*').order('nome');
    if (dbProdutos) setProdutos(dbProdutos);

    const { data: dbTamanhos } = await supabase.from('pizza_tamanhos').select('*').order('ordem');
    if (dbTamanhos) setTamanhosPizza(dbTamanhos);

    const { data: dbComandas } = await supabase
      .from('comandas')
      .select('*, itens_comanda(*, produtos(*))')
      .order('created_at', { ascending: false });
    
    if (dbComandas) setComandas(dbComandas);
    setCarregando(false);
  };

const fazerLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const senhaAdmin = process.env.NEXT_PUBLIC_SENHA_ADMIN;
    const senhaGarcom = process.env.NEXT_PUBLIC_SENHA_GARCOM;
    
    if (senhaDigitada === senhaAdmin) {
      setPerfilUsuario('admin');
      localStorage.setItem('perfilKim', 'admin'); // <-- SALVA AQUI
      setSenhaDigitada('');
      setErroLogin('');
    } else if (senhaDigitada === senhaGarcom) {
      setPerfilUsuario('garcom');
      localStorage.setItem('perfilKim', 'garcom'); // <-- SALVA AQUI
      setSenhaDigitada('');
      setErroLogin('');
    } else {
      setErroLogin('Senha incorreta! Tente novamente.');
    }
  };

  // Checa se o usuário já fez login antes
  useEffect(() => {
    const perfilSalvo = localStorage.getItem('perfilKim');
    if (perfilSalvo === 'admin' || perfilSalvo === 'garcom') {
      setPerfilUsuario(perfilSalvo);
    }
  }, []);

  const criarComanda = async () => {
    const nome = prompt("Nome da Comanda ou Mesa (ex: Mesa 05):");
    if (!nome) return;

    const { data, error } = await supabase
      .from('comandas')
      .insert([{ nome: nome }])
      .select()
      .single();

    if (error) {
      console.error("Erro ao criar mesa:", error);
      alert("Erro ao criar mesa no banco: " + error.message);
    } else if (data) {
      setComandas([{ ...data, itens_comanda: [] }, ...comandas]);
    }
  };

  const deletarComanda = async (id: number) => {
    if (!confirm("Tem certeza que deseja apagar esta comanda do sistema?")) return;
    
    await supabase.from('comandas').delete().eq('id', id);
    setComandas(comandas.filter((c) => c.id !== id));
  };

  const fecharComandaBanco = async (id: number) => {
    const { error } = await supabase.from('comandas').update({ status: 'fechada' }).eq('id', id);
    if (!error) carregarDados();
  };

  const reabrirComandaBanco = async (id: number) => {
    // Reabrir significa que a conta não foi paga: limpa a forma de
    // pagamento para o histórico não mentir depois.
    const { error } = await supabase
      .from('comandas')
      .update({ status: 'aberta', forma_pagamento: null })
      .eq('id', id);
    if (!error) carregarDados();
  };

  // Fecha a conta a partir da tela do caixa, gravando COMO o cliente pagou.
  const fecharContaComPagamento = async () => {
    if (!comandaAbertaId || fechandoConta) return;

    if (formaPagamento === "Pendente") {
      alert("Selecione a forma de pagamento antes de fechar a conta.");
      return;
    }

    if (rascunho.length > 0) {
      alert(
        `Há ${rascunho.length} ${rascunho.length === 1 ? 'item' : 'itens'} no pedido em montagem que ainda não foram confirmados. ` +
        `Confirme ou limpe antes de fechar a conta.`
      );
      return;
    }

    const total = comandaAtual ? calcularTotal(comandaAtual.itens_comanda) : 0;
    const ok = confirm(
      `Fechar a conta de ${comandaAtual?.nome}?\n\n` +
      `Total: R$ ${total.toFixed(2)}\n` +
      `Pagamento: ${formaPagamento}`
    );
    if (!ok) return;

    setFechandoConta(true);
    const { error } = await supabase
      .from('comandas')
      .update({ status: 'fechada', forma_pagamento: formaPagamento })
      .eq('id', comandaAbertaId);
    setFechandoConta(false);

    if (error) {
      alert('Não foi possível fechar a conta: ' + error.message);
      return;
    }

    setComandaAbertaId(null);
    setFormaPagamento("Pendente");
    await carregarDados();
  };

  // Toque no produto: pizza abre o configurador, o resto vai direto
  // para o rascunho. Nada ainda toca o banco.
  const escolherProduto = (produto: Produto) => {
    if (produto.eh_pizza) {
      setConfigPizza({
        sabor1: produto,
        tamanhoId: tamanhosPizza[0]?.id ?? null,
        varios: false,
        saboresExtra: [],
        observacao: "",
      });
      return;
    }

    if (produto.eh_suco_misto) {
      setConfigSuco({ produto, sabores: [] });
      return;
    }

    setRascunho((prev) => [...prev, {
      tempId: `${Date.now()}-${Math.random()}`,
      produto_id: produto.id,
      descricao: produto.nome,
      observacao: null,
      valor_unitario: Number(produto.preco),
      vai_para_cozinha: produto.vai_para_cozinha !== false,
    }]);
  };

  // Marca/desmarca um sabor adicional, respeitando o limite
  const alternarSaborExtra = (idSabor: number) => {
    if (!configPizza) return;
    const jaTem = configPizza.saboresExtra.includes(idSabor);
    if (jaTem) {
      setConfigPizza({
        ...configPizza,
        saboresExtra: configPizza.saboresExtra.filter((id) => id !== idSabor),
      });
    } else if (configPizza.saboresExtra.length < MAX_SABORES_EXTRA) {
      setConfigPizza({
        ...configPizza,
        saboresExtra: [...configPizza.saboresExtra, idSabor],
      });
    }
  };

  // "Pizza 30cm — Calabresa / Frango / Chic"
  // Sem fração: a divisão é sempre igual entre os sabores listados.
  const montarDescricaoPizza = (tamanhoNome: string, sabores: string[]) =>
    `Pizza ${tamanhoNome} — ${sabores.join(' / ')}`;

  // Fecha o configurador jogando a pizza montada no rascunho
  const adicionarPizzaAoRascunho = () => {
    if (!configPizza) return;
    const tamanho = tamanhosPizza.find((t) => t.id === configPizza.tamanhoId);
    if (!tamanho) return;

    // Mais de um sabor exige pelo menos um adicional escolhido
    if (configPizza.varios && configPizza.saboresExtra.length === 0) return;

    const nomesExtra = configPizza.varios
      ? configPizza.saboresExtra
          .map((id) => produtos.find((p) => p.id === id)?.nome)
          .filter((n): n is string => Boolean(n))
      : [];

    const observacao = configPizza.observacao.trim();

    setRascunho((prev) => [...prev, {
      tempId: `${Date.now()}-${Math.random()}`,
      produto_id: configPizza.sabor1.id,
      descricao: montarDescricaoPizza(tamanho.nome, [configPizza.sabor1.nome, ...nomesExtra]),
      observacao: observacao || null,
      // Todos os sabores custam igual, então o preço é o do tamanho
      valor_unitario: Number(tamanho.preco),
      vai_para_cozinha: true,
    }]);

    setConfigPizza(null);
  };

  // Marca/desmarca uma das duas metades do suco
  const alternarSaborSuco = (idSabor: number) => {
    if (!configSuco) return;
    const jaTem = configSuco.sabores.includes(idSabor);
    if (jaTem) {
      setConfigSuco({ ...configSuco, sabores: configSuco.sabores.filter((id) => id !== idSabor) });
    } else if (configSuco.sabores.length < 2) {
      setConfigSuco({ ...configSuco, sabores: [...configSuco.sabores, idSabor] });
    }
  };

  // "Suco de Laranja" -> "Laranja", para a descrição não ficar repetitiva
  const nomeCurtoSuco = (nome: string) => nome.replace(/^Suco de\s+/i, '');

  const adicionarSucoAoRascunho = () => {
    if (!configSuco || configSuco.sabores.length !== 2) return;

    const nomes = configSuco.sabores
      .map((id) => produtos.find((p) => p.id === id)?.nome)
      .filter((n): n is string => Boolean(n))
      .map(nomeCurtoSuco);

    if (nomes.length !== 2) return;

    setRascunho((prev) => [...prev, {
      tempId: `${Date.now()}-${Math.random()}`,
      produto_id: configSuco.produto.id,
      descricao: `Suco meio a meio — 1/2 ${nomes[0]} / 1/2 ${nomes[1]}`,
      observacao: null,
      valor_unitario: Number(configSuco.produto.preco),
      vai_para_cozinha: configSuco.produto.vai_para_cozinha !== false,
    }]);

    setConfigSuco(null);
  };

  const removerDoRascunho = (tempId: string) => {
    setRascunho((prev) => prev.filter((i) => i.tempId !== tempId));
  };

  // ESTE é o botão de confirmar: só aqui o pedido entra no banco,
  // cai na conta da mesa e dispara a ficha da cozinha.
  const confirmarPedido = async () => {
    if (rascunho.length === 0 || !comandaAbertaId || enviandoPedido) return;
    setEnviandoPedido(true);

    const { data, error } = await supabase
      .from('itens_comanda')
      .insert(rascunho.map((i) => ({
        comanda_id: comandaAbertaId,
        produto_id: i.produto_id,
        valor_unitario: i.valor_unitario,
        descricao: i.descricao,
        observacao: i.observacao,
      })))
      .select('*, produtos(*)');

    setEnviandoPedido(false);

    if (error) {
      alert('Não foi possível enviar o pedido: ' + error.message);
      return; // mantém o rascunho para o garçom tentar de novo
    }

    if (data) {
      setComandas((prev) => prev.map((c) =>
        c.id === comandaAbertaId
          ? { ...c, itens_comanda: [...(c.itens_comanda || []), ...data] }
          : c
      ));
      setRascunho([]);
    }
  };

  const removerItem = async (itemId: number) => {
    await supabase.from('itens_comanda').delete().eq('id', itemId);
    
    setComandas(comandas.map(c => {
      if (c.id === comandaAbertaId) {
        return { ...c, itens_comanda: c.itens_comanda.filter((item: any) => item.id !== itemId) };
      }
      return c;
    }));
  };


  const abrirComanda = (id: number) => {
    setComandaAbertaId(id);
    setFormaPagamento("Pendente");
    setCategoriaSelecionada("Todas");
    setBuscaProduto("");
    setCarrinhoMobileAberto(false);
    setRascunho([]); // rascunho é por mesa, nunca acompanha a troca
    setConfigPizza(null);
    setConfigSuco(null);
  };

  const fecharComandaTela = () => {
    // Sair com rascunho aberto jogaria o pedido fora sem avisar
    if (rascunho.length > 0) {
      const sair = confirm(
        `Você tem ${rascunho.length} ${rascunho.length === 1 ? 'item' : 'itens'} ainda não confirmados. ` +
        `Se sair agora, eles são descartados. Sair mesmo?`
      );
      if (!sair) return;
    }
    setComandaAbertaId(null);
    setFormaPagamento("Pendente");
    setRascunho([]);
    setConfigPizza(null);
    setConfigSuco(null);
  };

  const calcularTotal = (itens: any[]) => {
    if (!itens) return 0;
    return itens.reduce((acc, item) => acc + Number(item.valor_unitario), 0);
  };

  const comandaAtual = comandas.find((c) => c.id === comandaAbertaId);
  const comandasFiltradas = comandas.filter(c => c.nome.toLowerCase().includes(buscaComanda.toLowerCase()));
  
  const categoriasUnicas = ["Todas", ...Array.from(new Set(produtos.map(p => p.categoria || "Outros")))];

  const produtosFiltrados = produtos
    .filter(p => p.disponivel !== false) // <-- Só adicionou esta linha!
    .filter(p => p.nome.toLowerCase().includes(buscaProduto.toLowerCase()))
    .filter(p => categoriaSelecionada === "Todas" || (p.categoria || "Outros") === categoriaSelecionada);
  
  const produtosAgrupados = produtosFiltrados.reduce((acc: any, produto) => {
    const categoria = produto.categoria || "Outros";
    if (!acc[categoria]) acc[categoria] = [];
    acc[categoria].push(produto);
    return acc;
  }, {});

  // NOVO CÁLCULO: Agrupa TODOS os produtos (inclusive os esgotados) por categoria para o Admin
  const estoqueAgrupado = produtos.reduce((acc: any, produto) => {
    const categoria = produto.categoria || "Outros";
    if (!acc[categoria]) acc[categoria] = [];
    acc[categoria].push(produto);
    return acc;
  }, {});

  // Ordena as categorias em ordem alfabética para ficar mais fácil de achar
  const categoriasEstoque = Object.keys(estoqueAgrupado).sort();

  // Resumo do dia (usa todas as comandas, nao so as filtradas pela busca)
  const mesasAbertas = comandas.filter((c) => c.status === 'aberta');
  const mesasFechadas = comandas.filter((c) => c.status === 'fechada');
  const totalEmAberto = mesasAbertas.reduce((acc, c) => acc + calcularTotal(c.itens_comanda || []), 0);
  const totalFechado = mesasFechadas.reduce((acc, c) => acc + calcularTotal(c.itens_comanda || []), 0);

  // Nome que aparece na conta e na ficha. `descricao` é gravada no
  // item (traz tamanho e meio a meio); produtos antigos caem no nome.
  const nomeDoItem = (item: any) => item.descricao || item.produtos?.nome || 'Item';

  const itensCupomAgrupados = comandaAtual?.itens_comanda?.reduce((acc: any[], item: any) => {
    // Agrupa por descrição, não por produto: duas pizzas do mesmo sabor
    // em tamanhos diferentes são linhas separadas, com preços diferentes.
    // Observação também entra na chave: "sem cebola" é outro pedido
    // para a cozinha, mesmo sendo a mesma pizza pelo mesmo preço.
    const chave = `${item.produto_id}|${nomeDoItem(item)}|${item.observacao || ''}|${Number(item.valor_unitario)}`;
    const existente = acc.find((i: any) => i.chave === chave);
    if (existente) {
      existente.quantidade += 1;
      existente.valor_total += Number(item.valor_unitario);
      existente.ids_banco.push(item.id);
    } else {
      acc.push({
        chave,
        produto_id: item.produto_id,
        nome: nomeDoItem(item),
        observacao: item.observacao || null,
        quantidade: 1,
        valor_unitario: Number(item.valor_unitario),
        valor_total: Number(item.valor_unitario),
        ids_banco: [item.id]
      });
    }
    return acc;
  }, []);

  const totalRascunho = rascunho.reduce((acc, i) => acc + i.valor_unitario, 0);

  const alternarDisponibilidade = async (idProduto: number, statusAtual: boolean) => {
    const novoStatus = !statusAtual;
    
    // 1. Atualiza a tela instantaneamente (Visual)
    setProdutos((prev) => 
      prev.map((p) => p.id === idProduto ? { ...p, disponivel: novoStatus } : p)
    );

    // 2. Atualiza no banco de dados (Supabase)
    const { error } = await supabase
      .from('produtos')
      .update({ disponivel: novoStatus })
      .eq('id', idProduto);

    if (error) {
      alert('Erro ao atualizar disponibilidade. Tente novamente.');
      // Se der erro, desfaz a alteração visual
      carregarDados();
    }
  };

  // Liga/desliga a impressão de ficha na cozinha para um produto
  const alternarVaiParaCozinha = async (idProduto: number, statusAtual: boolean) => {
    const novoStatus = !statusAtual;

    setProdutos((prev) =>
      prev.map((p) => p.id === idProduto ? { ...p, vai_para_cozinha: novoStatus } : p)
    );

    const { error } = await supabase
      .from('produtos')
      .update({ vai_para_cozinha: novoStatus })
      .eq('id', idProduto);

    if (error) {
      alert('Erro ao atualizar o envio para a cozinha. Tente novamente.');
      carregarDados();
    }
  };

  if (perfilUsuario === null) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 font-sans print:hidden relative overflow-hidden">
  {/* Efeito visual de fundo */}
  <div className="absolute w-[500px] h-[500px] bg-gold-500/20 rounded-full blur-[100px] -top-20 -left-20"></div>
  <div className="absolute w-[400px] h-[400px] bg-gold-600/10 rounded-full blur-[80px] bottom-0 right-0"></div>

  {/* Cartão Branco Principal (Corrigido: agora existe apenas uma) */}
  <div className="bg-white p-8 md:p-12 rounded-3xl shadow-2xl w-full max-w-md relative z-10 border-t-4 border-gold-500">
    
    <div className="text-center mb-8">
      {/* Moldura circular dourada (mesma logica do header: logo reduzida, sem corte) */}
      <div className="w-24 h-24 rounded-full bg-black ring-2 ring-gold-500 shadow-lg flex items-center justify-center mx-auto mb-4">
        <Image
          src="/logoKim.jpg"
          alt="Logo Kim Restaurante e Pizzaria"
          width={150}
          height={150}
          priority
          className="w-[72%] h-[72%] object-contain"
        />
      </div>

      <h1 className="text-3xl font-black text-black tracking-tight uppercase leading-none">Kim</h1>
      <p className="text-gold-600 text-xs mt-1.5 uppercase tracking-[0.3em] font-bold">Restaurante e Pizzaria</p>
      <p className="text-neutral-500 text-sm mt-4 uppercase tracking-widest font-bold">Acesso ao Sistema</p>
    </div>

    {/* Formulário */}
    <form onSubmit={fazerLogin} className="space-y-6">
      <div>
        <label className="block text-neutral-700 text-sm font-bold mb-2">Senha de Acesso</label>
        <input
          type="password"
          placeholder="Digite a senha..."
          className="w-full bg-neutral-50 border border-neutral-200 text-black px-4 py-4 rounded-xl focus:outline-none focus:ring-4 focus:ring-gold-500/20 focus:border-gold-500 transition-all font-mono text-center text-xl tracking-widest"
          value={senhaDigitada}
          onChange={(e) => setSenhaDigitada(e.target.value)}
          autoFocus
        />
      </div>
      
      {erroLogin && (
        <p className="text-red-500 text-sm text-center font-bold animate-pulse">{erroLogin}</p>
      )}

      <button
        type="submit"
        className="w-full bg-black hover:bg-neutral-800 text-gold-500 font-bold py-4 rounded-xl transition-all active:scale-[0.98] shadow-[0_0_20px_-4px_rgba(201,162,39,0.4)] tracking-[0.15em] uppercase"
      >
        ENTRAR
      </button>
    </form>
  </div>
</div>
    );
  }


  if (carregando) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-neutral-50">
      <span className="h-10 w-10 rounded-full border-2 border-neutral-200 border-t-gold-500 animate-spin" />
      <p className="text-xs font-bold text-neutral-400 uppercase tracking-[0.25em]">Carregando sistema</p>
    </div>
  );

  if (comandaAbertaId === null) {
    return (
      // O Fragmento <> engloba tudo, separando a Ficha do Site Principal
      <>
        {/* ========================================= */}
        {/* FICHINHA DA COZINHA (SÓ APARECE NO PAPEL) */}
        {/* ========================================= */}
        {fichaCozinha && (
          <div className="hidden print:flex flex-col w-[80mm] text-black font-mono bg-white absolute top-0 left-0 z-50">
            {/* Cabeçalho da Ficha */}
            <div className="text-center border-b-[3px] border-black pb-2 mb-4 mt-2">
              <h2 className="text-2xl font-black uppercase tracking-widest">COZINHA</h2>
              <p className="text-sm font-bold">KIM RESTAURANTE E PIZZARIA</p>
            </div>

            {/* Nome da Mesa bem grande */}
            <div className="text-center mb-6">
              <h1 className="text-5xl font-black uppercase border-y-2 border-dashed border-black py-2">
                {fichaCozinha.mesa}
              </h1>
            </div>

            {/* O Item e a Quantidade */}
            <div className="flex items-start gap-4 mb-4">
              <span className="text-4xl font-black">{fichaCozinha.qtd}X</span>
              <p className="text-3xl font-bold uppercase leading-tight mt-1">{fichaCozinha.item}</p>
            </div>

            {/* OBSERVAÇÃO — moldura grossa para a cozinha não passar batido */}
            {fichaCozinha.obs && (
              <div className="border-[3px] border-black p-2 mb-6">
                <p className="text-xs font-black uppercase tracking-widest border-b border-black pb-1 mb-1.5">
                  Observação
                </p>
                <p className="text-2xl font-black uppercase leading-tight break-words">
                  {fichaCozinha.obs}
                </p>
              </div>
            )}

            {/* Rodapé com a Hora */}
            <div className="border-t-2 border-black pt-2 flex justify-between text-sm font-bold mt-4 mb-10">
              <span>DATA: {new Date().toLocaleDateString('pt-BR')}</span>
              <span>HORA: {fichaCozinha.hora}</span>
            </div>
            
            {/* Espaço em branco pro rolo da impressora térmica cortar certinho */}
            <div className="h-10 text-white">.</div>
          </div>
        )}

        {/* ========================================= */}
        {/* SITE PRINCIPAL (ESCONDIDO NA IMPRESSÃO)   */}
        {/* ========================================= */}
        <div className="min-h-screen bg-neutral-50 p-4 sm:p-6 lg:p-8 print:hidden font-sans">
          <div className="mx-auto max-w-[1600px]">

          <header className="relative overflow-hidden bg-black text-white p-5 sm:p-6 lg:p-8 rounded-2xl mb-6 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.5)] flex flex-col md:flex-row justify-between items-center gap-5">
            {/* Fio dourado no topo, no lugar da borda grossa */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500 to-transparent" />
            <div className="flex items-center gap-4">
              {/* Moldura circular dourada. A logo entra reduzida (72%) em vez de
                  preenchida: o circulo cortaria as pontas do K e do M. */}
              <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-black ring-2 ring-gold-500 flex items-center justify-center shrink-0">
                <Image
                  src="/logoKim.jpg"
                  alt="Logo Kim Restaurante e Pizzaria"
                  width={150}
                  height={150}
                  priority
                  className="w-[72%] h-[72%] object-contain"
                />
              </div>
              <div>
                <h1 className="text-3xl md:text-4xl font-black tracking-wider text-gold-500 leading-none">
                  KIM
                </h1>
                <p className="text-white text-xs md:text-sm font-light tracking-[0.25em] uppercase mt-1">Restaurante e Pizzaria</p>
                <p className="text-neutral-500 text-xs tracking-widest uppercase mt-1.5">Painel de Comandas</p>
              </div>
            </div>
            
            {/* Todos os botoes usam a mesma altura (h-12) para alinharem na linha */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              {perfilUsuario === 'admin' && (
                <button
                  onClick={() => setMostrarEstoque(!mostrarEstoque)}
                  className={`h-12 px-4 rounded-xl font-semibold text-sm flex items-center gap-2 transition-colors ${
                    mostrarEstoque
                    ? 'bg-gold-500 text-black'
                    : 'bg-white/5 text-neutral-300 border border-white/15 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <IconSettings className="w-4 h-4" />
                  <span className="hidden sm:inline">{mostrarEstoque ? 'Fechar estoque' : 'Estoque'}</span>
                </button>
              )}

              <button
                onClick={() => {
                  setPerfilUsuario(null);
                  localStorage.removeItem('perfilKim');
                }}
                className="h-12 px-4 rounded-xl font-semibold text-sm flex items-center gap-2 bg-white/5 text-neutral-300 border border-white/15 hover:bg-white/10 hover:text-white transition-colors"
              >
                <IconLogout className="w-4 h-4" />
                <span className="hidden sm:inline">Sair</span>
              </button>

              <button
                onClick={criarComanda}
                className="flex-1 md:flex-none h-12 px-5 bg-gold-500 text-black rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-gold-400 active:scale-[0.98] transition-all shadow-[0_4px_20px_-4px_rgba(201,162,39,0.6)]"
              >
                <IconPlus className="w-5 h-5" />
                Nova mesa
              </button>
            </div>
          </header>

          {/* ========================================= */}
          {/* ALERTAS DE NOVOS PEDIDOS (SÓ PARA ADMIN)  */}
          {/* ========================================= */}
          {perfilUsuario === 'admin' && pedidosPendentes.length > 0 && (
            <div className="mb-6 rounded-2xl border border-gold-300 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4 bg-gold-50 border-b border-gold-200">
                <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gold-500 text-black shrink-0">
                  <IconBell className="w-[18px] h-[18px]" />
                  <span className="absolute inset-0 rounded-full bg-gold-500 animate-ping opacity-40" />
                </span>
                <div>
                  <h3 className="text-black font-bold text-base leading-tight">Pedidos aguardando impressão</h3>
                  <p className="text-gold-700 text-xs font-medium mt-0.5">
                    {pedidosPendentes.length} {pedidosPendentes.length === 1 ? 'ficha na fila' : 'fichas na fila'}
                  </p>
                </div>
              </div>

              <div className="divide-y divide-neutral-100">
                {pedidosPendentes.map((pedido, index) => (
                  <div key={index} className="px-5 py-3.5 flex justify-between items-center gap-4">
                    <div className="min-w-0">
                      <p className="font-bold text-black truncate">{pedido.mesa}</p>
                      <p className="text-neutral-500 text-sm">
                        <span className="font-semibold text-neutral-700">{pedido.qtd}x</span> {pedido.item}
                      </p>
                      {pedido.obs && (
                        <p className="mt-1 inline-block bg-gold-100 text-gold-800 text-xs font-semibold px-2 py-0.5 rounded">
                          Obs: {pedido.obs}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2 shrink-0">
                      {/* Dispensar sem imprimir */}
                      <button
                        onClick={() => {
                          setPedidosPendentes((prev) => prev.filter((_, i) => i !== index));
                        }}
                        className="h-10 w-10 flex items-center justify-center rounded-lg border border-neutral-200 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
                        title="Dispensar sem imprimir"
                      >
                        <IconX className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => {
                          imprimirFichaCozinha(pedido.mesa, pedido.item, pedido.qtd, pedido.obs);
                          setPedidosPendentes((prev) => prev.filter((_, i) => i !== index));
                        }}
                        className="h-10 px-4 rounded-lg bg-black text-gold-500 font-semibold text-sm flex items-center gap-2 hover:bg-neutral-800 active:scale-[0.98] transition-all"
                      >
                        <IconPrinter className="w-4 h-4" />
                        Imprimir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        {/* ========================================= */}
        {/* CONTROLE DE ESTOQUE (SÓ PARA ADMIN)       */}
        {/* ========================================= */}
        {perfilUsuario === 'admin' && mostrarEstoque && (
          <div className="mb-6 bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 sm:px-6 py-4 border-b border-neutral-100">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 shrink-0">
                <IconSettings className="w-[18px] h-[18px]" />
              </span>
              <div>
                <h2 className="text-base font-bold text-black leading-tight">Controle de estoque</h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Toque no item para esgotar. A etiqueta da direita define se ele imprime ficha na cozinha.
                </p>
              </div>
            </div>

            <div className="p-5 sm:p-6 flex flex-col gap-7">
              {categoriasEstoque.map((categoria) => (
                <div key={categoria}>
                  <h3 className="text-[11px] font-bold text-neutral-400 mb-3 uppercase tracking-[0.15em]">
                    {categoria}
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {estoqueAgrupado[categoria].map((produto: any) => {
                      const ativo = produto.disponivel !== false;
                      const naCozinha = produto.vai_para_cozinha !== false;
                      return (
                        <div
                          key={produto.id}
                          className={`flex justify-between items-center gap-2 p-3.5 rounded-xl border transition-all ${
                            ativo
                              ? 'bg-white border-neutral-200'
                              : 'bg-neutral-50 border-neutral-200'
                          }`}
                        >
                          <button
                            onClick={() => alternarDisponibilidade(produto.id, produto.disponivel ?? true)}
                            className="flex items-center gap-2.5 min-w-0 text-left group"
                            title={ativo ? 'Marcar como esgotado' : 'Voltar para o cardápio'}
                          >
                            <span
                              className={`flex items-center justify-center h-6 w-6 rounded-full shrink-0 transition-colors ${
                                ativo
                                  ? 'bg-gold-100 text-gold-700 group-hover:bg-gold-200'
                                  : 'bg-red-100 text-red-700 group-hover:bg-red-200'
                              }`}
                            >
                              {ativo ? <IconCheck className="w-3.5 h-3.5" /> : <IconX className="w-3.5 h-3.5" />}
                            </span>
                            <span className={`font-semibold text-sm leading-tight truncate ${ativo ? 'text-neutral-800' : 'text-neutral-400 line-through'}`}>
                              {produto.nome}
                            </span>
                          </button>

                          {/* Chave da cozinha: define se este item gera ficha */}
                          <button
                            onClick={() => alternarVaiParaCozinha(produto.id, produto.vai_para_cozinha ?? true)}
                            className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 border transition-colors ${
                              naCozinha
                                ? 'bg-black text-gold-500 border-black hover:bg-neutral-800'
                                : 'bg-white text-neutral-400 border-neutral-300 hover:border-neutral-500 hover:text-neutral-600'
                            }`}
                            title={naCozinha
                              ? 'Imprime ficha na cozinha — clique para desligar'
                              : 'Só entra na conta, não imprime ficha — clique para ligar'}
                          >
                            {naCozinha ? 'Cozinha' : 'Bar'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

          {/* BUSCA + RESUMO */}
          <div className="mb-8 flex flex-col lg:flex-row lg:items-center gap-4">
            <div className="relative flex-1 max-w-xl">
              <IconSearch className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar por mesa ou cliente..."
                className="w-full bg-white border border-neutral-200 text-neutral-800 placeholder-neutral-400 pl-12 pr-11 py-3.5 rounded-xl shadow-sm focus:ring-4 focus:ring-gold-500/15 focus:border-gold-500 outline-none transition-all font-medium"
                value={buscaComanda}
                onChange={(e) => setBuscaComanda(e.target.value)}
              />
              {buscaComanda && (
                <button
                  onClick={() => setBuscaComanda("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
                  title="Limpar busca"
                >
                  <IconX className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* O garçom vê só a contagem de mesas. Faturamento do dia
                (em aberto e já fechado) é informação de caixa: só admin. */}
            <div className={`grid gap-2.5 lg:ml-auto ${
              perfilUsuario === 'admin' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1'
            }`}>
              <div className="bg-white border border-neutral-200 rounded-xl px-4 py-3 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">Mesas abertas</p>
                <p className="text-xl font-bold text-black mt-0.5 tabular-nums">{mesasAbertas.length}</p>
              </div>

              {perfilUsuario === 'admin' && (
                <>
                  <div className="bg-white border border-neutral-200 rounded-xl px-4 py-3 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">Em aberto</p>
                    <p className="text-xl font-bold text-black mt-0.5 tabular-nums">
                      <span className="text-sm text-gold-600 font-semibold mr-0.5">R$</span>
                      {totalEmAberto.toFixed(2)}
                    </p>
                  </div>
                  <div className="col-span-2 sm:col-span-1 bg-white border border-neutral-200 rounded-xl px-4 py-3 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">Já fechado</p>
                    <p className="text-xl font-bold text-neutral-500 mt-0.5 tabular-nums">
                      <span className="text-sm font-semibold mr-0.5">R$</span>
                      {totalFechado.toFixed(2)}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ========================================= */}
          {/* SESSÃO 1: COMANDAS ABERTAS                */}
          {/* ========================================= */}
          <div className="mb-12">
            <div className="flex items-baseline gap-3 mb-4">
              <h2 className="text-sm font-bold text-neutral-800 uppercase tracking-[0.15em] flex items-center gap-2.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-gold-500 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-gold-500" />
                </span>
                Mesas abertas
              </h2>
              <span className="text-sm text-neutral-400 font-medium tabular-nums">
                {comandasFiltradas.filter(c => c.status === 'aberta').length}
              </span>
            </div>

            {comandasFiltradas.filter(c => c.status === 'aberta').length === 0 ? (
              <div className="text-center py-16 px-6 bg-white border border-dashed border-neutral-300 rounded-2xl">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 mb-4">
                  <IconTable className="w-7 h-7" />
                </span>
                <p className="text-neutral-700 font-semibold">
                  {buscaComanda ? 'Nenhuma mesa encontrada' : 'Nenhuma mesa aberta'}
                </p>
                <p className="text-neutral-400 text-sm mt-1">
                  {buscaComanda
                    ? `Nada corresponde a "${buscaComanda}".`
                    : 'Use o botão “Nova mesa” para abrir a primeira comanda.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {comandasFiltradas.filter(c => c.status === 'aberta').map((comanda) => (
                  <div
                    key={comanda.id}
                    className="bg-white rounded-2xl border border-neutral-200 shadow-sm hover:shadow-lg hover:border-neutral-300 hover:-translate-y-0.5 transition-all duration-200 relative flex flex-col overflow-hidden"
                  >
                    <span className="absolute inset-x-0 top-0 h-1 bg-gold-500" />

                    <div className="p-5 pt-6 flex flex-col flex-grow">
                      <div className="flex justify-between items-start gap-2 mb-4">
                        <h3 className="text-lg font-bold text-black leading-tight truncate">
                          {comanda.nome}
                        </h3>
                        <span className="bg-neutral-100 text-neutral-600 text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 tabular-nums">
                          {comanda.itens_comanda?.length || 0} {comanda.itens_comanda?.length === 1 ? 'item' : 'itens'}
                        </span>
                      </div>

                      {/* Prévia dos itens */}
                      <div className="flex-grow mb-4 h-28 overflow-y-auto pr-1">
                        {comanda.itens_comanda?.length === 0 ? (
                          <div className="h-full flex items-center justify-center">
                            <p className="text-xs text-neutral-400">Nenhum pedido ainda</p>
                          </div>
                        ) : (
                          <ul className="space-y-1.5">
                            {comanda.itens_comanda?.map((item: any, idx: number) => (
                              <li key={idx} className="flex justify-between items-baseline gap-2 text-[13px]">
                                <span className="text-neutral-600 truncate">{nomeDoItem(item)}</span>
                                <span className="text-neutral-500 font-medium whitespace-nowrap tabular-nums">
                                  {Number(item.valor_unitario || 0).toFixed(2)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="pt-4 border-t border-neutral-100">
                        <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-[0.15em]">Total da conta</p>
                        <p className="text-2xl font-bold text-black mt-1 tabular-nums">
                          <span className="text-base text-gold-600 font-semibold mr-1">R$</span>
                          {calcularTotal(comanda.itens_comanda).toFixed(2)}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2 p-4 pt-0">
                      <button
                        onClick={() => abrirComanda(comanda.id)}
                        className="flex-1 h-11 bg-black text-gold-500 rounded-xl font-semibold text-sm hover:bg-neutral-800 active:scale-[0.98] transition-all"
                      >
                        Abrir mesa
                      </button>

                      {perfilUsuario === 'admin' && (
                        <>
                          <button
                            onClick={() => fecharComandaBanco(comanda.id)}
                            className="h-11 w-11 shrink-0 bg-neutral-100 text-neutral-600 rounded-xl hover:bg-neutral-200 hover:text-black transition-colors flex items-center justify-center"
                            title="Encerrar conta"
                          >
                            <IconLock className="w-[18px] h-[18px]" />
                          </button>
                          <button
                            onClick={() => deletarComanda(comanda.id)}
                            className="h-11 w-11 shrink-0 bg-neutral-100 text-neutral-500 rounded-xl hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center"
                            title="Excluir definitivamente"
                          >
                            <IconTrash className="w-[18px] h-[18px]" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ========================================= */}
          {/* SESSÃO 2: COMANDAS FECHADAS               */}
          {/* ========================================= */}
          <div className="pb-12 border-t border-neutral-200 pt-10">
            <div className="flex items-baseline gap-3 mb-4">
              <h2 className="text-sm font-bold text-neutral-500 uppercase tracking-[0.15em] flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-neutral-300" />
                Histórico de fechadas
              </h2>
              <span className="text-sm text-neutral-400 font-medium tabular-nums">
                {comandasFiltradas.filter(c => c.status === 'fechada').length}
              </span>
            </div>

            {comandasFiltradas.filter(c => c.status === 'fechada').length === 0 ? (
              <p className="text-neutral-400 text-sm">Nenhuma mesa foi encerrada ainda.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {comandasFiltradas.filter(c => c.status === 'fechada').map(comanda => (
                  <div
                    key={comanda.id}
                    className="bg-neutral-100/70 rounded-2xl border border-neutral-200 flex flex-col hover:bg-neutral-100 transition-colors"
                  >
                    <div className="p-5 flex flex-col flex-grow">
                      <div className="flex justify-between items-start gap-2 mb-3">
                        <h3 className="font-semibold text-base text-neutral-500 truncate">{comanda.nome}</h3>
                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400 bg-white border border-neutral-200 px-2 py-1 rounded-full shrink-0">
                          Encerrada
                        </span>
                      </div>

                      {/* Como o cliente pagou */}
                      <div className="mb-3">
                        {comanda.forma_pagamento ? (
                          <span className="inline-flex items-center gap-1.5 bg-black text-gold-500 px-2.5 py-1 rounded-lg text-[11px] font-semibold">
                            {comanda.forma_pagamento === 'Dinheiro' && <IconCash className="w-3.5 h-3.5" />}
                            {comanda.forma_pagamento === 'Cartão' && <IconCard className="w-3.5 h-3.5" />}
                            {comanda.forma_pagamento === 'Pix' && <IconPix className="w-3.5 h-3.5" />}
                            {comanda.forma_pagamento}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 bg-white border border-dashed border-neutral-300 text-neutral-400 px-2.5 py-1 rounded-lg text-[11px] font-semibold">
                            Pagamento não registrado
                          </span>
                        )}
                      </div>

                      <div className="flex-grow mb-4 h-20 overflow-y-auto pr-1">
                        <ul className="space-y-1.5">
                          {comanda.itens_comanda?.map((item: any, idx: number) => (
                            <li key={idx} className="flex justify-between items-baseline gap-2 text-[13px] text-neutral-400">
                              <span className="truncate">{nomeDoItem(item)}</span>
                              <span className="whitespace-nowrap tabular-nums">
                                {Number(item.valor_unitario || 0).toFixed(2)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="pt-4 border-t border-neutral-200">
                        <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-[0.15em]">
                          {comanda.itens_comanda?.length || 0} {comanda.itens_comanda?.length === 1 ? 'item' : 'itens'}
                        </p>
                        <p className="text-xl font-bold text-neutral-600 mt-1 tabular-nums">
                          <span className="text-sm font-semibold mr-1">R$</span>
                          {calcularTotal(comanda.itens_comanda).toFixed(2)}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2 p-4 pt-0">
                      {perfilUsuario === 'admin' ? (
                        <>
                          <button
                            onClick={() => reabrirComandaBanco(comanda.id)}
                            className="flex-1 h-10 bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-50 hover:border-neutral-400 font-semibold rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
                          >
                            <IconRotateLeft className="w-4 h-4" />
                            Reabrir
                          </button>
                          <button
                            onClick={() => deletarComanda(comanda.id)}
                            className="h-10 w-10 shrink-0 bg-white border border-neutral-300 text-neutral-500 hover:bg-red-500 hover:border-red-500 hover:text-white flex items-center justify-center rounded-xl transition-colors"
                            title="Excluir definitivamente"
                          >
                            <IconTrash className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <p className="text-[11px] text-neutral-400 text-center w-full py-2 uppercase tracking-[0.12em] font-semibold">
                          Acesso restrito
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          </div>
        </div>
      </>
    );
  }


  return (
    <div className="flex h-screen bg-neutral-50 font-sans text-neutral-800 print:bg-white print:h-auto print:block">

      <style>{`
        @media print {
          @page { margin: 0; }
          body, html { margin: 0 !important; padding: 0 !important; }
        }
      `}</style>
      
      {/* LADO ESQUERDO: PAINEL DE CARDÁPIO */}
      <div className="w-full lg:w-2/3 p-4 lg:p-8 flex flex-col h-full overflow-hidden print:hidden">
        
        {/* CABEÇALHO */}
        <div className="flex items-center gap-4 mb-4 bg-white p-4 lg:px-5 rounded-2xl shadow-sm border border-neutral-200 shrink-0">
          <button
            onClick={fecharComandaTela}
            className="flex items-center justify-center w-11 h-11 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl transition-colors shrink-0"
            title="Voltar para as mesas"
          >
            <IconArrowLeft className="w-5 h-5" />
          </button>
          <div className="overflow-hidden min-w-0">
            <p className="text-[10px] lg:text-[11px] font-bold text-gold-600 uppercase tracking-[0.18em]">Comanda aberta</p>
            <h1 className="text-xl lg:text-2xl font-bold text-black truncate leading-tight">{comandaAtual?.nome}</h1>
          </div>
          <div className="ml-auto text-right shrink-0 hidden sm:block">
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-[0.15em]">Total</p>
            <p className="text-xl font-bold text-black tabular-nums leading-tight">
              <span className="text-sm text-gold-600 font-semibold mr-0.5">R$</span>
              {comandaAtual ? calcularTotal(comandaAtual.itens_comanda).toFixed(2) : "0.00"}
            </p>
          </div>
        </div>

        {/* ABAS MOBILE (Ocultas no PC) */}
        <div className="flex lg:hidden bg-neutral-200/70 p-1 rounded-xl mb-4 shrink-0">
          <button
            onClick={() => setCarrinhoMobileAberto(false)}
            className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all flex justify-center items-center gap-2 ${!carrinhoMobileAberto ? 'bg-white shadow-sm text-black' : 'text-neutral-500'}`}
          >
            <IconMenuBook className="w-4 h-4" />
            Cardápio
          </button>
          <button
            onClick={() => setCarrinhoMobileAberto(true)}
            className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all flex justify-center items-center gap-2 ${carrinhoMobileAberto ? 'bg-white shadow-sm text-black' : 'text-neutral-500'}`}
          >
            <IconReceipt className="w-4 h-4" />
            Comanda
            <span className={`px-1.5 py-0.5 rounded-md text-[11px] font-bold tabular-nums ${carrinhoMobileAberto ? 'bg-gold-500 text-black' : 'bg-neutral-300 text-neutral-600'}`}>
              {comandaAtual?.itens_comanda?.length || 0}
            </span>
          </button>
        </div>

        {/* ÁREA 1: CARDÁPIO (Sempre visível no PC. No mobile, só visível se a aba Cardápio estiver ativa) */}
        <div className={`flex-col flex-grow overflow-hidden ${!carrinhoMobileAberto ? 'flex' : 'hidden lg:flex'}`}>
          <div className="relative mb-4 shrink-0">
            <IconSearch className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Pesquisar produto no cardápio..."
              className="w-full bg-white border border-neutral-200 text-neutral-800 placeholder-neutral-400 pl-12 pr-11 py-3.5 rounded-xl shadow-sm focus:ring-4 focus:ring-gold-500/15 focus:border-gold-500 outline-none transition-all font-medium"
              value={buscaProduto}
              onChange={(e) => setBuscaProduto(e.target.value)}
            />
            {buscaProduto && (
              <button
                onClick={() => setBuscaProduto("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
                title="Limpar busca"
              >
                <IconX className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex gap-2 overflow-x-auto pb-3 mb-1 shrink-0 scrollbar-hide">
            {categoriasUnicas.map(categoria => (
              <button
                key={categoria}
                onClick={() => setCategoriaSelecionada(categoria)}
                className={`px-4 py-2 rounded-full font-semibold text-sm whitespace-nowrap transition-colors border ${
                  categoriaSelecionada === categoria
                  ? "bg-black text-gold-500 border-black"
                  : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400 hover:text-black"
                }`}
              >
                {categoria}
              </button>
            ))}
          </div>
          
          <div className="overflow-y-auto pr-2 pb-10 flex-grow">
            {Object.keys(produtosAgrupados).length === 0 ? (
              <div className="text-center py-16 px-6">
                <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 mb-4">
                  <IconSearch className="w-7 h-7" />
                </span>
                <p className="text-neutral-700 font-semibold">Nenhum produto encontrado</p>
                <p className="text-neutral-400 text-sm mt-1">Tente outro termo ou mude a categoria.</p>
              </div>
            ) : (
              Object.entries(produtosAgrupados).map(([categoria, itens]: any) => (
                <div key={categoria} className="mb-9">
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-[11px] font-bold uppercase text-neutral-400 tracking-[0.18em] shrink-0">
                      {categoria}
                    </h2>
                    <div className="h-px bg-neutral-200 w-full"></div>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {itens.map((produto: any) => (
                      <button
                        key={produto.id}
                        onClick={() => escolherProduto(produto)}
                        className="bg-white p-4 rounded-xl shadow-sm border border-neutral-200 hover:border-gold-500 hover:shadow-md active:scale-[0.98] flex justify-between items-center gap-3 text-left transition-all group min-h-[5.5rem]"
                      >
                        <div className="flex flex-col justify-center min-w-0">
                          <h3 className="font-semibold text-neutral-800 leading-snug text-sm">
                            {produto.nome}
                          </h3>
                          {produto.eh_pizza ? (
                            <p className="text-neutral-500 text-xs mt-1">
                              a partir de{' '}
                              <span className="tabular-nums">
                                <span className="text-gold-600 font-semibold">R$</span> {Number(produto.preco).toFixed(2)}
                              </span>
                            </p>
                          ) : (
                            <p className="text-neutral-500 text-sm mt-1 tabular-nums">
                              <span className="text-gold-600 font-semibold">R$</span> {Number(produto.preco).toFixed(2)}
                            </p>
                          )}
                        </div>
                        <span
                          className="bg-neutral-100 text-neutral-500 group-hover:bg-black group-hover:text-gold-500 w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-colors"
                          aria-hidden
                        >
                          {(produto.eh_pizza || produto.eh_suco_misto)
                            ? <IconSettings className="w-5 h-5" />
                            : <IconPlus className="w-5 h-5" />}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ================================================= */}
        {/* RASCUNHO: o pedido em montagem.                   */}
        {/* Nada aqui existe no banco ainda — só entra na      */}
        {/* conta e na cozinha ao confirmar.                   */}
        {/* ================================================= */}
        {rascunho.length > 0 && (
          <div className="shrink-0 mt-3 bg-white rounded-2xl border-2 border-gold-500 shadow-[0_-8px_30px_-10px_rgba(0,0,0,0.15)] overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gold-50 border-b border-gold-200">
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-gold-700">
                Pedido em montagem · não enviado
              </p>
              <button
                onClick={() => setRascunho([])}
                className="text-[11px] font-semibold text-neutral-500 hover:text-red-600 transition-colors"
              >
                Limpar
              </button>
            </div>

            <ul className="divide-y divide-neutral-100 max-h-44 overflow-y-auto">
              {rascunho.map((item) => (
                <li key={item.tempId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-800">{item.descricao}</p>
                    {item.observacao && (
                      <p className="text-xs text-gold-800 bg-gold-100 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                        Obs: {item.observacao}
                      </p>
                    )}
                    <p className="text-xs text-neutral-500 tabular-nums">
                      R$ {item.valor_unitario.toFixed(2)}
                      {!item.vai_para_cozinha && (
                        <span className="ml-2 text-neutral-400">· não vai para a cozinha</span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => removerDoRascunho(item.tempId)}
                    className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 hover:bg-red-500 hover:text-white transition-colors"
                    title="Tirar do pedido"
                  >
                    <IconTrash className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-3 p-3 border-t border-neutral-200">
              <div className="pl-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">
                  {rascunho.length} {rascunho.length === 1 ? 'item' : 'itens'}
                </p>
                <p className="text-lg font-bold text-black tabular-nums leading-tight">
                  <span className="text-sm text-gold-600 font-semibold mr-0.5">R$</span>
                  {totalRascunho.toFixed(2)}
                </p>
              </div>
              <button
                onClick={confirmarPedido}
                disabled={enviandoPedido}
                className="flex-1 h-12 bg-black text-gold-500 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-neutral-800 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {enviandoPedido ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-gold-500/30 border-t-gold-500 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <IconCheck className="w-5 h-5" />
                    Confirmar pedido
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ÁREA 2: CARRINHO DO GARÇOM (Invisível no PC. No mobile, só aparece se a aba Comanda estiver ativa) */}
        <div className={`flex-col flex-grow overflow-y-auto bg-white rounded-2xl p-4 shadow-sm border border-neutral-200 ${carrinhoMobileAberto ? 'flex' : 'hidden'} lg:hidden`}>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-400 border-b border-neutral-200 pb-3 mb-4">
            Resumo do pedido
          </h3>

          {itensCupomAgrupados?.length === 0 ? (
            <div className="text-center py-10 my-auto">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 mb-4">
                <IconReceipt className="w-7 h-7" />
              </span>
              <p className="text-neutral-700 font-semibold mb-1">Comanda vazia</p>
              <p className="text-neutral-400 text-sm mb-6">Nenhum produto foi adicionado.</p>
              <button
                onClick={() => setCarrinhoMobileAberto(false)}
                className="h-11 px-5 bg-black text-gold-500 font-semibold text-sm rounded-xl hover:bg-neutral-800 transition-colors inline-flex items-center gap-2"
              >
                <IconMenuBook className="w-4 h-4" />
                Ver cardápio
              </button>
            </div>
          ) : (
            <div className="pb-6">
              <ul className="divide-y divide-neutral-100">
                {itensCupomAgrupados?.map((item: any) => (
                  <li key={item.chave} className="flex justify-between items-center gap-3 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="bg-black text-gold-500 w-9 h-9 flex items-center justify-center rounded-lg font-bold text-sm shrink-0 tabular-nums">
                        {item.quantidade}x
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-neutral-800 leading-snug text-sm break-words">{item.nome}</p>
                        {item.observacao && (
                          <p className="text-xs text-gold-800 bg-gold-100 px-1.5 py-0.5 rounded mt-1 inline-block">
                            Obs: {item.observacao}
                          </p>
                        )}
                        <p className="text-neutral-500 text-sm mt-0.5 tabular-nums">R$ {item.valor_total.toFixed(2)}</p>
                      </div>
                    </div>

                    {/* Só o admin pode remover item lançado */}
                    {perfilUsuario === 'admin' && (
                      <button
                        onClick={() => removerItem(item.ids_banco[item.ids_banco.length - 1])}
                        className="w-10 h-10 shrink-0 flex items-center justify-center bg-neutral-100 text-neutral-500 rounded-xl hover:bg-red-500 hover:text-white transition-colors active:scale-95"
                        title="Remover uma unidade"
                      >
                        <IconTrash className="w-4 h-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              <div className="mt-5 border-t border-neutral-200 pt-4 text-right">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400 mb-1">Total da mesa</p>
                <p className="text-3xl font-bold text-black tabular-nums">
                  <span className="text-lg text-gold-600 font-semibold mr-1">R$</span>
                  {comandaAtual ? calcularTotal(comandaAtual.itens_comanda).toFixed(2) : "0.00"}
                </p>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* LADO DIREITO: O CUPOM E CAIXA */}
      <div className="hidden lg:flex lg:w-1/3 bg-neutral-100 border-l border-neutral-200 flex-col shadow-2xl z-10 relative print:block print:w-full print:absolute print:top-0 print:left-0 print:border-none print:shadow-none print:bg-white print:h-auto print:p-0 print:m-0">
        
        <div className="absolute inset-0 bg-black print:hidden h-40"></div>

        <div className="flex-grow w-full max-w-[340px] mx-auto mt-6 mb-4 bg-white rounded-t-sm shadow-xl p-6 print:max-w-[80mm] print:m-0 print:p-0 print:mt-0 print:pt-0 font-mono text-sm text-black overflow-y-auto print:overflow-visible z-10 print:shadow-none">
          
          {/* CABEÇALHO DA NOTINHA */}
          <div className="text-center mb-6 border-b-2 border-dashed border-neutral-300 print:border-black pb-4 print:mt-0">
            <h2 className="text-2xl font-bold uppercase tracking-widest print:text-black print:font-black">Kim</h2>
            <p className="text-xs text-neutral-500 print:text-black print:font-bold mt-1 uppercase tracking-widest">Restaurante e Pizzaria</p>
          </div>
          
          <div className="mb-6 text-sm font-bold bg-neutral-50 p-2 rounded print:bg-transparent print:p-0 print:text-black print:font-black text-center">
            <p className="uppercase text-lg">MESA: {comandaAtual?.nome}</p>
          </div>

          {/* TABELA DE PRODUTOS */}
          <table className="w-full text-left mb-6 text-xs">
            <thead>
              <tr className="border-b-2 border-dashed border-neutral-300 print:border-black text-neutral-500 print:text-black print:font-bold">
                <th className="pb-2 font-semibold print:font-black">QTD</th>
                <th className="pb-2 font-semibold print:font-black">ITEM</th>
                <th className="text-right pb-2 font-semibold print:font-black">R$</th>
                <th className="text-right pb-2 print:hidden"></th>
              </tr>
            </thead>
            <tbody className="align-top">
              {itensCupomAgrupados?.map((item: any) => (
                <tr key={item.chave} className="border-b border-neutral-100 print:border-dashed print:border-b-2 print:border-black group print:text-black print:font-bold print:break-inside-avoid">
                  <td className="py-2 pr-2 text-neutral-500 print:text-black print:font-black">{item.quantidade}x</td>
                  <td className="py-2 pr-2 font-medium print:font-bold">{item.nome}</td>
                  <td className="py-2 text-right font-medium print:font-black">{item.valor_total.toFixed(2)}</td>
                  <td className="py-2 text-right print:hidden opacity-0 group-hover:opacity-100 transition-opacity">
                    
                    {/* TRAVA DO ADMIN APLICADA NO BOTÃO 'X' */}
                    {perfilUsuario === 'admin' && (
                      <button 
                        onClick={() => removerItem(item.ids_banco[item.ids_banco.length - 1])} 
                        className="text-red-500 ml-2 bg-red-50 w-6 h-6 rounded flex items-center justify-center font-bold hover:bg-red-500 hover:text-white transition-colors"
                        title="Remover 1 unidade"
                      >
                        X
                      </button>
                    )}
                    
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* TOTAL */}
          <div className="border-t-2 border-dashed border-neutral-300 print:border-black pt-4 text-right print:break-inside-avoid">
            <p className="text-xs text-neutral-500 print:text-black print:font-bold mb-1 uppercase">Total a pagar</p>
            <h3 className="text-2xl font-black tracking-tighter print:text-black print:font-black">
              R$ {comandaAtual ? calcularTotal(comandaAtual.itens_comanda).toFixed(2) : "0.00"}
            </h3>
          </div>

          <div className="border-t-2 border-dashed border-neutral-300 print:border-black pt-3 mt-4 text-xs print:break-inside-avoid">
            <p className="text-neutral-500 print:text-black print:font-bold">Forma de Pagamento:</p>
            <p className="font-bold uppercase text-sm mt-1 print:text-black print:font-black">{formaPagamento}</p>
          </div>

          {/* MÁGICA DO QR CODE PIX */}
          {formaPagamento === 'Pix' && (
            <div className="mt-4 mb-2 flex flex-col items-center border-t-2 border-b-2 border-dashed border-neutral-300 print:border-black py-4 print:break-inside-avoid">
              <p className="text-xs font-bold text-neutral-800 print:text-black print:font-black uppercase tracking-widest mb-2">Pague com PIX</p>
              
              <img src="/pix.png" alt="QR Code PIX" className="w-32 h-32 object-contain print:block grayscale print:contrast-125" />
              
              <p className="text-[11px] mt-2 text-neutral-500 print:text-black print:font-bold text-center">
                Chave: (31) 99650-5970 <br/>
                <span className="font-normal print:font-bold text-neutral-400 print:text-black">Kim Restaurante e Pizzaria</span>
              </p>
            </div>
          )}
          
          {/* RODAPÉ */}
          <div className="text-center mt-6 text-xs border-t-2 border-dashed border-neutral-300 print:border-black pt-6 pb-4 print:pb-0 text-neutral-500 print:text-black print:font-bold flex flex-col items-center justify-center print:break-inside-avoid">
            <p className="font-bold text-black print:font-black mb-1">Obrigado pela preferência!</p>
            <p className="mb-4">Volte sempre.</p>
            
            <p className="text-[10px] bg-neutral-100 print:bg-transparent print:text-black print:font-bold inline-block px-3 py-1 rounded-full border border-neutral-200 print:border-none print:px-0">
              Emitido em: {new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          </div>
        </div>

        {/* BOTÕES DE PAGAMENTO (Não saem na impressão) */}
        <div className="bg-white border-t border-neutral-200 p-5 z-10 print:hidden shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
          <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-[0.15em] mb-2.5">Forma de pagamento</p>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {([
              { nome: "Dinheiro", Icone: IconCash },
              { nome: "Cartão", Icone: IconCard },
              { nome: "Pix", Icone: IconPix },
            ] as const).map(({ nome, Icone }) => (
              <button
                key={nome}
                onClick={() => setFormaPagamento(nome)}
                aria-pressed={formaPagamento === nome}
                className={`h-16 rounded-xl font-semibold text-xs border flex flex-col items-center justify-center gap-1.5 transition-all ${
                  formaPagamento === nome
                    ? "bg-black border-black text-gold-500 shadow-md"
                    : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-black"
                }`}
              >
                <Icone className="w-5 h-5" />
                {nome}
              </button>
            ))}
          </div>

          <button
            onClick={() => window.print()}
            className="w-full py-4 bg-black text-gold-500 font-semibold rounded-xl hover:bg-neutral-800 shadow-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          >
            <IconPrinter className="w-5 h-5" />
            Imprimir conta
          </button>

          {/* FECHAR CONTA — grava a forma de pagamento e manda a mesa
              para o histórico. Só admin, igual ao cadeado do painel. */}
          {perfilUsuario === 'admin' ? (
            <>
              <button
                onClick={fecharContaComPagamento}
                disabled={fechandoConta || formaPagamento === "Pendente"}
                className="w-full mt-2.5 py-4 bg-white border-2 border-black text-black font-semibold rounded-xl hover:bg-neutral-100 flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
              >
                {fechandoConta ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-neutral-300 border-t-black animate-spin" />
                    Fechando...
                  </>
                ) : (
                  <>
                    <IconLock className="w-5 h-5" />
                    Fechar conta
                  </>
                )}
              </button>
              {formaPagamento === "Pendente" && (
                <p className="text-[11px] text-neutral-400 text-center mt-2">
                  Selecione a forma de pagamento para liberar o fechamento.
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-neutral-400 text-center mt-3 uppercase tracking-[0.12em] font-semibold">
              Fechamento de conta: só o administrador
            </p>
          )}
        </div>
      </div>

      {/* ================================================= */}
      {/* CONFIGURADOR DE PIZZA                             */}
      {/* ================================================= */}
      {configPizza && (() => {
        const tamanho = tamanhosPizza.find((t) => t.id === configPizza.tamanhoId);
        const nomesExtra = configPizza.saboresExtra
          .map((id) => produtos.find((p) => p.id === id)?.nome)
          .filter((n): n is string => Boolean(n));
        const faltaSabor = configPizza.varios && configPizza.saboresExtra.length === 0;
        const limiteAtingido = configPizza.saboresExtra.length >= MAX_SABORES_EXTRA;
        // Outros sabores de pizza, para as demais frações
        const outrosSabores = produtos
          .filter((p) => p.eh_pizza && p.disponivel !== false && p.id !== configPizza.sabor1.id);
        const totalSabores = 1 + (configPizza.varios ? configPizza.saboresExtra.length : 0);

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 print:hidden">
            <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">

              {/* Cabeçalho */}
              <div className="flex items-start justify-between gap-3 p-5 border-b border-neutral-200 shrink-0">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold-600">Montar pizza</p>
                  <h2 className="text-xl font-bold text-black leading-tight truncate">{configPizza.sabor1.nome}</h2>
                </div>
                <button
                  onClick={() => setConfigPizza(null)}
                  className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors"
                  title="Cancelar"
                >
                  <IconX className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 overflow-y-auto flex flex-col gap-6">
                {/* TAMANHO */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-400 mb-2.5">Tamanho</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {tamanhosPizza.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setConfigPizza({ ...configPizza, tamanhoId: t.id })}
                        className={`p-3 rounded-xl border text-center transition-all ${
                          configPizza.tamanhoId === t.id
                            ? 'bg-black border-black text-white'
                            : 'bg-white border-neutral-200 text-neutral-700 hover:border-neutral-400'
                        }`}
                      >
                        <p className="font-bold text-base leading-none">{t.nome}</p>
                        {t.fatias && (
                          <p className={`text-[11px] mt-1 ${configPizza.tamanhoId === t.id ? 'text-neutral-400' : 'text-neutral-500'}`}>
                            {t.fatias}
                          </p>
                        )}
                        <p className={`text-sm font-semibold mt-1.5 tabular-nums ${configPizza.tamanhoId === t.id ? 'text-gold-500' : 'text-neutral-800'}`}>
                          R$ {Number(t.preco).toFixed(2)}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* UM SABOR OU MAIS DE UM */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-400 mb-2.5">Sabores</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setConfigPizza({ ...configPizza, varios: false, saboresExtra: [] })}
                      className={`py-3 rounded-xl border font-semibold text-sm transition-all ${
                        !configPizza.varios
                          ? 'bg-black border-black text-gold-500'
                          : 'bg-white border-neutral-200 text-neutral-600 hover:border-neutral-400'
                      }`}
                    >
                      Um sabor
                    </button>
                    <button
                      onClick={() => setConfigPizza({ ...configPizza, varios: true })}
                      className={`py-3 rounded-xl border font-semibold text-sm transition-all ${
                        configPizza.varios
                          ? 'bg-black border-black text-gold-500'
                          : 'bg-white border-neutral-200 text-neutral-600 hover:border-neutral-400'
                      }`}
                    >
                      Mais de um sabor
                    </button>
                  </div>
                  <p className="text-xs text-neutral-400 mt-2">
                    Até {MAX_SABORES_EXTRA + 1} sabores na mesma pizza. O preço não muda: todos
                    custam igual no mesmo tamanho.
                  </p>
                </div>

                {/* SABORES ADICIONAIS */}
                {configPizza.varios && (
                  <div>
                    <div className="flex items-baseline justify-between gap-2 mb-2.5">
                      <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-400">
                        Outros sabores
                      </p>
                      <p className={`text-[11px] font-semibold tabular-nums ${limiteAtingido ? 'text-gold-700' : 'text-neutral-400'}`}>
                        {configPizza.saboresExtra.length} de {MAX_SABORES_EXTRA}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                      {outrosSabores.map((p) => {
                        const marcado = configPizza.saboresExtra.includes(p.id);
                        // Cheio: só deixa desmarcar o que já está escolhido
                        const bloqueado = !marcado && limiteAtingido;
                        return (
                          <button
                            key={p.id}
                            onClick={() => alternarSaborExtra(p.id)}
                            disabled={bloqueado}
                            className={`px-3 py-2.5 rounded-xl border text-left text-sm font-medium transition-all flex items-center gap-2 ${
                              marcado
                                ? 'bg-gold-500 border-gold-500 text-black font-semibold'
                                : bloqueado
                                  ? 'bg-neutral-50 border-neutral-200 text-neutral-300 cursor-not-allowed'
                                  : 'bg-white border-neutral-200 text-neutral-700 hover:border-neutral-400'
                            }`}
                          >
                            {marcado && <IconCheck className="w-4 h-4 shrink-0" />}
                            <span className="truncate">{p.nome}</span>
                          </button>
                        );
                      })}
                    </div>

                    {limiteAtingido && (
                      <p className="text-xs text-gold-700 mt-2">
                        Limite de {MAX_SABORES_EXTRA + 1} sabores atingido. Desmarque um para trocar.
                      </p>
                    )}
                  </div>
                )}

                {/* OBSERVAÇÕES (só pizza) */}
                <div>
                  <label htmlFor="obs-pizza" className="block text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-400 mb-2.5">
                    Observações
                  </label>
                  <textarea
                    id="obs-pizza"
                    value={configPizza.observacao}
                    onChange={(e) => setConfigPizza({ ...configPizza, observacao: e.target.value })}
                    rows={2}
                    maxLength={200}
                    placeholder="Ex: sem cebola, borda sem sal, bem assada..."
                    className="w-full bg-white border border-neutral-200 text-neutral-800 placeholder-neutral-400 px-4 py-3 rounded-xl resize-none focus:ring-4 focus:ring-gold-500/15 focus:border-gold-500 outline-none transition-all text-sm"
                  />
                  <p className="text-xs text-neutral-400 mt-1.5">
                    Sai destacada na ficha da cozinha. {configPizza.observacao.length}/200
                  </p>
                </div>
              </div>

              {/* Rodapé com resumo e ação */}
              <div className="p-5 border-t border-neutral-200 bg-neutral-50 shrink-0">
                <div className="mb-3">
                  <p className="text-sm text-neutral-600 leading-snug">
                    {tamanho ? (
                      faltaSabor ? (
                        <span className="text-gold-700 font-medium">Escolha pelo menos um sabor adicional</span>
                      ) : (
                        <span className="font-semibold text-black">
                          {montarDescricaoPizza(tamanho.nome, [configPizza.sabor1.nome, ...nomesExtra])}
                        </span>
                      )
                    ) : 'Escolha o tamanho'}
                  </p>
                  {tamanho && !faltaSabor && totalSabores > 1 && (
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {totalSabores} sabores, {tamanho.fatias ? `${tamanho.fatias} no total` : 'divididos igualmente'}
                    </p>
                  )}
                  {configPizza.observacao.trim() && (
                    <p className="text-xs text-gold-800 bg-gold-100 px-2 py-1 rounded mt-2 inline-block">
                      Obs: {configPizza.observacao.trim()}
                    </p>
                  )}
                </div>

                <button
                  onClick={adicionarPizzaAoRascunho}
                  disabled={!tamanho || faltaSabor}
                  className="w-full py-4 bg-black text-gold-500 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-neutral-800 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <IconPlus className="w-5 h-5" />
                  Adicionar ao pedido
                  {tamanho && !faltaSabor && (
                    <span className="tabular-nums font-semibold">· R$ {Number(tamanho.preco).toFixed(2)}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ================================================= */}
      {/* CONFIGURADOR DE SUCO MEIO A MEIO                  */}
      {/* ================================================= */}
      {configSuco && (() => {
        const saboresDisponiveis = produtos
          .filter((p) => p.eh_sabor_suco && p.disponivel !== false);
        const completo = configSuco.sabores.length === 2;
        const nomes = configSuco.sabores
          .map((id) => produtos.find((p) => p.id === id)?.nome)
          .filter((n): n is string => Boolean(n))
          .map(nomeCurtoSuco);

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 print:hidden">
            <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">

              <div className="flex items-start justify-between gap-3 p-5 border-b border-neutral-200 shrink-0">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold-600">Montar suco</p>
                  <h2 className="text-xl font-bold text-black leading-tight truncate">{configSuco.produto.nome}</h2>
                </div>
                <button
                  onClick={() => setConfigSuco(null)}
                  className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors"
                  title="Cancelar"
                >
                  <IconX className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 overflow-y-auto">
                <div className="flex items-baseline justify-between gap-2 mb-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-neutral-400">
                    Escolha os dois sabores
                  </p>
                  <p className={`text-[11px] font-semibold tabular-nums ${completo ? 'text-gold-700' : 'text-neutral-400'}`}>
                    {configSuco.sabores.length} de 2
                  </p>
                </div>

                {saboresDisponiveis.length === 0 ? (
                  <p className="text-sm text-neutral-500 py-6 text-center">
                    Nenhum sabor de suco marcado no cardápio.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {saboresDisponiveis.map((p) => {
                      const marcado = configSuco.sabores.includes(p.id);
                      const bloqueado = !marcado && completo;
                      return (
                        <button
                          key={p.id}
                          onClick={() => alternarSaborSuco(p.id)}
                          disabled={bloqueado}
                          className={`px-3 py-2.5 rounded-xl border text-left text-sm font-medium transition-all flex items-center gap-2 ${
                            marcado
                              ? 'bg-gold-500 border-gold-500 text-black font-semibold'
                              : bloqueado
                                ? 'bg-neutral-50 border-neutral-200 text-neutral-300 cursor-not-allowed'
                                : 'bg-white border-neutral-200 text-neutral-700 hover:border-neutral-400'
                          }`}
                        >
                          {marcado && <IconCheck className="w-4 h-4 shrink-0" />}
                          <span className="truncate">{nomeCurtoSuco(p.nome)}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {completo && (
                  <p className="text-xs text-gold-700 mt-3">
                    Para trocar um sabor, desmarque primeiro.
                  </p>
                )}
              </div>

              <div className="p-5 border-t border-neutral-200 bg-neutral-50 shrink-0">
                <p className="text-sm text-neutral-600 mb-3 leading-snug">
                  {completo ? (
                    <span className="font-semibold text-black">
                      Suco meio a meio — 1/2 {nomes[0]} / 1/2 {nomes[1]}
                    </span>
                  ) : (
                    <span className="text-gold-700 font-medium">
                      Faltam {2 - configSuco.sabores.length} {2 - configSuco.sabores.length === 1 ? 'sabor' : 'sabores'}
                    </span>
                  )}
                </p>

                <button
                  onClick={adicionarSucoAoRascunho}
                  disabled={!completo}
                  className="w-full py-4 bg-black text-gold-500 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-neutral-800 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <IconPlus className="w-5 h-5" />
                  Adicionar ao pedido
                  {completo && (
                    <span className="tabular-nums font-semibold">
                      · R$ {Number(configSuco.produto.preco).toFixed(2)}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}