import Controller from "sap/ui/core/mvc/Controller";
import UIComponent from "sap/ui/core/UIComponent";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import History from "sap/ui/core/routing/History";
import ODataListBinding from "sap/ui/model/odata/v2/ODataListBinding";
import Table from "sap/m/Table";
import MessageToast from "sap/m/MessageToast";
import GroupHeaderListItem from "sap/m/GroupHeaderListItem";
import ODataModel from "sap/ui/model/odata/v2/ODataModel";
import Context from "sap/ui/model/Context";
import NumberFormat from "sap/ui/core/format/NumberFormat";
import MessageBox from "sap/m/MessageBox";
import Button from "sap/m/Button";
import Title from "sap/m/Title";
import JSONModel from "sap/ui/model/json/JSONModel";
import ColumnListItem from "sap/m/ColumnListItem";
import Label from "sap/m/Label";
import Text from "sap/m/Text";
import Link from "sap/m/Link";
import ObjectStatus from "sap/m/ObjectStatus";
import { AggregationBindingInfo } from "sap/ui/base/ManagedObject";
import DateType from "sap/ui/model/type/Date"; 
import VBox from "sap/m/VBox";
import FilterType from "sap/ui/model/FilterType"; 
import Select from "sap/m/Select";
import ScrollContainer from "sap/m/ScrollContainer";
import BusyDialog from "sap/m/BusyDialog";
import StepInput from "sap/m/StepInput";
import Dialog from "sap/m/Dialog";
import Fragment from "sap/ui/core/Fragment";

/**
 * @namespace contractbilling.controller
 */
export default class ContractDetail extends Controller {

    private _iPendingRequests: number = 0;
    private _oBusyDialog: BusyDialog;
   
    private _oConfirmDialog: any;
private _aItemsToProcess: any[];
    

    public onInit(): void {
        const oComponent = this.getOwnerComponent() as UIComponent;
        const oRouter = oComponent?.getRouter();

        
    
        // Inicializamos el modelo local para persistir los planes de facturación
        const oLocalModel = new JSONModel({
            planesDetalle: {},
            resumen: {
        clientes: 0,
        contratos: 0,
        posiciones: 0
        }
            
        });
        this.getView()?.setModel(oLocalModel, "local");
        (this.byId("slYearFilter") as Select).setSelectedKey("2026");
        
        if (oRouter) {
            const oRoute = oRouter.getRoute("RouteContractDetail");
            if (oRoute) {
                oRoute.attachPatternMatched(this._onObjectMatched, this);
            }
        }
    }


private _updateTableStatistics(): void {
    const oTable = this.byId("tableContracts") as Table;
    const oBinding = oTable.getBinding("items") as ODataListBinding;
    const aContexts = oBinding.getContexts();
    const oLocalModel = this.getView()?.getModel("local") as JSONModel;

    // Obtenemos los objetos puros para contar
    const aData = aContexts.map(oCtx => oCtx.getObject() as any);

    // Cálculos
    const iPosiciones = aData.length;
    const iContratos = new Set(aData.map(o => o.Contrato)).size;
    const iClientes = new Set(aData.map(o => o.Cliente)).size;

    // Actualizamos el modelo local para que la UI se refresque sola
    oLocalModel.setProperty("/resumen", {
        clientes: iClientes,
        contratos: iContratos,
        posiciones: iPosiciones
    });
}


private _onObjectMatched(oEvent: any): void {
    const oView = this.getView();
    if (!oView) return;

    // --- REINICIO DE ESTADOS (Limpieza anterior) ---
    oView.setBusy(false); 
    this._iPendingRequests = 0;
    if (this._oBusyDialog) { this._oBusyDialog.close(); }
    const oLocalModel = oView.getModel("local") as JSONModel;
    oLocalModel.setProperty("/planesDetalle", {});

    // --- LEER PARÁMETROS DE LA URL ---
    const oArgs = oEvent.getParameter("arguments");
    const sCustomer = oArgs.customerId;
    const sDate = oArgs.date;
    const oQuery = oArgs["?query"]; // Parámetros opcionales del F5

    // Recuperar y restaurar modelo de petición
    const oModelPeticion = this.getOwnerComponent()?.getModel("mBillingContract") as JSONModel;
    
    if (oQuery && oModelPeticion) {
        // Si hay datos en la URL (F5), los reinyectamos al modelo
        if (oQuery.status) oModelPeticion.setProperty("/oQuery/selectedStatus", oQuery.status.split(","));
        if (oQuery.quotation) oModelPeticion.setProperty("/oQuery/selectedQuotations", oQuery.quotation.split(","));
        if (oQuery.customers) oModelPeticion.setProperty("/oQuery/selectedCustomers", oQuery.customers.split(","));
    }

    // Ahora leemos del modelo (que ya tiene los datos del F5 si aplica)
    const aSelectedCustomers = oModelPeticion?.getProperty("/oQuery/selectedCustomers") || [];
    const aSelectedQuotations = oModelPeticion?.getProperty("/oQuery/selectedQuotations") || [];
    const aSelectedStatus = oModelPeticion?.getProperty("/oQuery/selectedStatus") || [];

    const aFinalFilters: Filter[] = [];

    // --- FILTROS DE CLIENTE ---
    if (sCustomer === "multi" && aSelectedCustomers.length > 0) {
        aFinalFilters.push(new Filter({
            filters: aSelectedCustomers.map((id: string) => new Filter("Cliente", FilterOperator.EQ, id)),
            and: false
        }));
    } else if (sCustomer && sCustomer !== "multi" && sCustomer !== "all") {
        aFinalFilters.push(new Filter("Cliente", FilterOperator.EQ, sCustomer));
    }

    // --- FILTROS DE COTIZACIÓN ---
    if (aSelectedQuotations.length > 0) {
        aFinalFilters.push(new Filter({
            filters: aSelectedQuotations.map((id: string) => new Filter("Contrato", FilterOperator.EQ, id)),
            and: false
        }));
    }

    // --- FILTROS DE ESTATUS ---
    if (aSelectedStatus.length > 0) {
        aFinalFilters.push(new Filter({
            filters: aSelectedStatus.map((key: string) => new Filter("Status", FilterOperator.EQ, key)),
            and: false
        }));
    }

    // --- FILTRO DE FECHA ---
    if (sDate && sDate !== "all") {
        if (sDate.includes("_")) {
            const [sIni, sFin] = sDate.split("_");
            aFinalFilters.push(new Filter("VigenciaIniPos", FilterOperator.BT, sIni, sFin));
        } else {
            aFinalFilters.push(new Filter("VigenciaIniPos", FilterOperator.EQ, sDate));
        }
    }

    // --- EJECUCIÓN DEL BINDING ---
    const oTable = this.byId("tableContracts") as Table;
    const oBinding = oTable?.getBinding("items") as ODataListBinding;

    if (oBinding) {
        oView.setBusy(true);
        if (oBinding.isSuspended()) oBinding.resume();

        oBinding.attachEventOnce("dataReceived", () => {
            oView.setBusy(false);
            this._updateTableStatistics();
            setTimeout(() => this.onExpandAll(), 200);
        });

        oBinding.filter(aFinalFilters, FilterType.Application);
    }
}



    public onTogglePlanDetail(oEvent: any): void {
        const oButton = oEvent.getSource();
        const oContext = oButton.getBindingContext("ZSD_GET_CONTRACT_BILLING_SRV");
        const oEntry = oContext.getObject();
        const oVBoxDetalle = oButton.getParent().getItems()[1];
        
        const sKey = oEntry.Contrato + "_" + oEntry.PosContrato;
        const oLocalModel = this.getView()?.getModel("local") as JSONModel;
        
        if (!oVBoxDetalle.getVisible()) {
            // Verificar si el plan ya fue cargado previamente
            const bLoaded = oLocalModel.getProperty("/planesDetalle/" + sKey + "_Loaded");
            
            if (!bLoaded) {
                this._fetchBillingPlan(oContext, oVBoxDetalle);
            }
            oVBoxDetalle.setVisible(true);
            oButton.setIcon("sap-icon://navigation-down-arrow");
        } else {
            oVBoxDetalle.setVisible(false);
            oButton.setIcon("sap-icon://navigation-right-arrow");
        }
    }

private _fetchBillingPlan(oContext: any, oContainer: any): void {
    const oView = this.getView();
    const oModel = oView?.getModel("ZSD_GET_CONTRACT_BILLING_SRV") as ODataModel;
    const oLocalModel = oView?.getModel("local") as JSONModel;
    const oEntry = oContext.getObject();
    
    oContainer.setBusy(true);

    const oPayload = {
        "IdPeticion": "FETCH_PLAN_" + oEntry.Contrato + "_" + oEntry.PosContrato,
        "BillingPlanRequestSet": [{ "Contrato": oEntry.Contrato, "PosContrato": oEntry.PosContrato }],
        "BillingPlanItemsSet": [] 
    };

    const sKey = oEntry.Contrato + "_" + oEntry.PosContrato;

    oModel.create("/BillingPlanSet", oPayload, {
        groupId: "changeset_" + sKey, 
        success: (oData: any) => {
            this._finalizeRequest(oContainer); 
            const aPlanItems = oData.BillingPlanItemsSet?.results || [];

            if (aPlanItems.length > 0) {
                oLocalModel.setProperty("/planesDetalle/" + sKey, aPlanItems);
                oLocalModel.setProperty("/planesDetalle/" + sKey + "_Loaded", true);

                (oLocalModel as any).checkUpdate(true);

                const oScroll = oContainer.getItems()[1];
                const oTableDetalle = oScroll.getContent()[0] as Table; 

                if (oTableDetalle && typeof oTableDetalle.bindItems === "function") {
                    // Sincronizamos anchos de columna con el encabezado del XML
                    /*const aColumns = oTableDetalle.getColumns();
                    
                    if (aColumns.length >= 4) {
                        aColumns[0].setWidth("30%"); // Mes / Año
                        aColumns[1].setWidth("25%"); // Orden
                        aColumns[2].setWidth("25%"); // Factura
                        aColumns[3].setWidth("20%"); // Estado
                    }
                        */

                    const aColumns = oTableDetalle.getColumns();
if (aColumns.length >= 4) {
    aColumns[0].setWidth("120px");
    aColumns[1].setWidth("150px");
    aColumns[2].setWidth("150px");
    aColumns[3].setWidth("120px");
     }
                    
                    oTableDetalle.bindItems({
                        path: "local>/planesDetalle/" + sKey,
                        template: new ColumnListItem({
                            cells: [
                                new Label({ 
                                    design: "Bold", 
                                    text: { 
                                        path: "local>Afdat", 
                                        type: new (DateType as any)({ source: { pattern: "yyyyMMdd" } }, { pattern: "MMM yyyy" }) 
                                    } 
                                }),
                                new VBox({
                                    renderType: "Bare",
                                    items: [
                                        new Text({
                                            text: {
                                                path: "local>Orden",
                                                formatter: (sOrden: string) => {
                                                    if (!sOrden || sOrden === "---") return "---";
                                                    const sRaw = sOrden.includes("|") ? sOrden.split("|")[0].trim() : sOrden.trim();
                                                    return sRaw.replace(/^0+/, ''); 
                                                }
                                            },
                                            visible: "{= ${local>Orden} !== '---' }"
                                        }),
                                        new ObjectStatus({
                                            text: {
                                                path: "local>Orden",
                                                formatter: (sOrden: string) => {
                                                    if (sOrden && sOrden.includes("|")) {
                                                        const aParts = sOrden.split("|");
                                                        return aParts.length >= 3 ? aParts[2].trim() : "";
                                                    }
                                                    return "";
                                                }
                                            },
                                            state: "Indication05",
                                            visible: {
                                                path: "local>Orden",
                                                formatter: (sOrden: string) => !!(sOrden && sOrden.includes("|"))
                                            }
                                        }).addStyleClass("myOrderBadge") 
                                    ]
                                }),
                                new Link({ text: "{local>Factura}", visible: "{= !!${local>Factura} }" }),
                                new ObjectStatus({ 
                                    text: "{= ${local>Factura}  ? 'FACTURADO' : 'PENDIENTE' }",
                                    state: "{= ${local>Factura} ? 'Success' : 'Warning' }",
                                    icon: "{= ${local>Factura}  ? 'sap-icon://accept' : 'sap-icon://alert' }"
                                })
                            ]
                        }),
                        templateShareable: false
                    });

                    const sCurrentMonth = (this.byId("slMonthFilter") as Select).getSelectedKey();
                    this._applyPlanLocalFilter(oTableDetalle.getBinding("items"), sCurrentMonth);
                    oTableDetalle.setFixedLayout(true); // Forzamos el layout fijo para respetar porcentajes
                }
            }
        },
        error: (oError: any) => {
            this._finalizeRequest(oContainer);
            console.error("Error OData:", oError);
        }
    });
}


/**
 * Expande el plan de facturación únicamente de las filas seleccionadas
 */
public onExpandSelected(): void {
    const oTable = this.byId("tableContracts") as Table;
    const aSelectedItems = oTable.getSelectedItems();

    if (aSelectedItems.length === 0) {
        MessageToast.show("Selecciona al menos una posición para expandir.");
        return;
    }

    aSelectedItems.forEach((oItem: any) => {
        // En tu estructura, el VBox de detalle es el último elemento de la celda (índice 7)
        const aCells = oItem.getCells();
        const oVBoxContenedor = aCells[aCells.length - 1] as VBox;
        const oBtnToggle = oVBoxContenedor.getItems()[0] as Button;
        const oVBoxDetalle = oVBoxContenedor.getItems()[1] as VBox;

        // Si no está visible, simulamos el click para que cargue los datos y expanda
        if (!oVBoxDetalle.getVisible()) {
            this.onTogglePlanDetail({
                getSource: () => oBtnToggle
            });
        }
    });
}

/**
 * Colapsa todos los planes de facturación visibles en la tabla
 */
public onCollapseAll(): void {
    const oTable = this.byId("tableContracts") as Table;
    const aItems = oTable.getItems();

    aItems.forEach((oItem: any) => {
        // Ignorar encabezados de grupo
        if (oItem.getCells) {
            const aCells = oItem.getCells();
            const oVBoxContenedor = aCells[aCells.length - 1] as VBox;
            const oBtnToggle = oVBoxContenedor.getItems()[0] as Button;
            const oVBoxDetalle = oVBoxContenedor.getItems()[1] as VBox;

            // Si está visible, lo ocultamos y reseteamos el icono
            if (oVBoxDetalle.getVisible()) {
                oVBoxDetalle.setVisible(false);
                oBtnToggle.setIcon("sap-icon://navigation-right-arrow");
            }
        }
    });
}


    public getGroupHeader(oGroup: any): GroupHeaderListItem {
        const sContrato = oGroup.key;
        const aContexts = (oGroup.contexts || []) as Context[];
        let oData: any = (aContexts.length > 0) ? aContexts[0].getObject() : null;

        if (!oData || !oData.NombreCliente) {
            const oTable = this.byId("tableContracts") as Table;
            const oBinding = oTable?.getBinding("items") as ODataListBinding;
            const aAllContexts = oBinding?.getContexts();
            const oMatch = aAllContexts?.find(ctx => ctx.getProperty("Contrato") === sContrato);
            if (oMatch) { oData = oMatch.getObject(); }
        }

        const fTotalGrupo = aContexts.reduce((acc: number, ctx: Context) => {
            const fImporte = parseFloat(ctx.getProperty("Total") as string) || 0;
            return acc + fImporte;
        }, 0);

        const oCurrencyFormat = NumberFormat.getCurrencyInstance({
            currencyCode: false,
            customCurrencies: { "MXN": { "digits": 2 } }
        });

        const sSumaFormateada = oCurrencyFormat.format(fTotalGrupo, "MXN");

        if (oData && oData.NombreCliente) {
            return new GroupHeaderListItem({
                title: `Doc.: ${sContrato} | Contrato: ${oData.NContrato} | ${oData.NombreCliente} | RFC: ${oData.RFC} | Ejecutivo: ${oData.NombreEjecutivo}`,
                upperCase: false
            });
        }

        return new GroupHeaderListItem({
            title: `Contrato: ${sContrato} (Cargando...)`,
            upperCase: false
        });
    }

    public formatPos(sPos: string): string {
        return sPos ? parseInt(sPos, 10).toString() : "";
    }

    public onSelectAll(): void {
        (this.byId("tableContracts") as Table).selectAll();
    }

    public onDeselectAll(): void {
        (this.byId("tableContracts") as Table).removeSelections(true);
    }

   public onNavBack(): void {
    // 1. Forzar el cierre del BusyDialog si existe
    if (this._oBusyDialog) {
        this._oBusyDialog.close();
    }
    
    // 2. Quitar el estado busy de la vista
    this.getView()?.setBusy(false);

    // 3. Resetear contadores internos
    this._iPendingRequests = 0;

    const oHistory = History.getInstance();
    if (oHistory.getPreviousHash() !== undefined) {
        window.history.go(-1);
    } else {
        (this.getOwnerComponent() as UIComponent)?.getRouter().navTo("RouteMain", {}, true);
    }
}

    public getSelectedContracts(): any[] {
        const oTable = this.byId("tableContracts") as Table;
        const aSelectedItems = oTable.getSelectedItems();
        
        if (!aSelectedItems || aSelectedItems.length === 0) {
            MessageToast.show("Por favor, seleccione al menos una partida.");
            return [];
        }

        return aSelectedItems
            .map((oItem) => {
                const oContext = oItem.getBindingContext("ZSD_GET_CONTRACT_BILLING_SRV");
                return oContext ? oContext.getObject() : null;
            })
            .filter((oData) => oData !== null);
    }

    /**
     * Procesa la facturación masiva validando que todos los ítems sean del mismo cliente
     * Si hay mezcla, muestra los nombres de todos los clientes seleccionados.
     */
    /**
     * Procesa la facturación masiva validando cliente único y preguntando 
     * si desea factura global o por contrato si hay múltiples contratos.
     */
/**
     * Procesa la facturación masiva validando cliente único y preguntando 
     * si desea factura global o por contrato si hay múltiples contratos.
     */

//    public async onProcessBilling(): Promise<void> {
//     const oTable = this.byId("tableContracts") as Table;
//     const aSelectedItems = oTable.getSelectedItems();
    
//     if (!aSelectedItems || aSelectedItems.length === 0) {
//         MessageToast.show("Por favor, seleccione al menos una partida.");
//         return; 
//     }

//     const oMonthSelect = this.byId("slMonthFilter") as Select;
//     const oYearSelect = this.byId("slYearFilter") as Select;
//     const sMonth = oMonthSelect.getSelectedKey();
//     const sYear = oYearSelect.getSelectedKey();

//     if (sMonth === "all" || sYear === "all") {
//         MessageBox.warning("Para procesar la factura, debe seleccionar un MES y un AÑO específicos.");
//         return;
//     }

//     this.getView()?.setBusy(true);

//     const oLocalModel = this.getView()?.getModel("local") as JSONModel;
//     const aDataToProcess: any[] = [];
//     const aAlreadyBilled: string[] = [];
//     const aRejectedByRule: string[] = [];

//     // 1. Filtrado de posiciones (Reglas de Negocio + Facturación previa)
//     for (const oItem of aSelectedItems) {
//         const oContext = oItem.getBindingContext("ZSD_GET_CONTRACT_BILLING_SRV");
        
//         // --- SOLUCIÓN AL ERROR TS(18048): Validación de existencia de oContext ---
//         if (!oContext) {
//             continue; 
//         }

//         const oData = oContext.getObject() as any;
//         const sKey = oData.Contrato + "_" + oData.PosContrato;
        
//         // --- ASEGURAR CARGA DEL PLAN ---
//         let aPlan = oLocalModel.getProperty("/planesDetalle/" + sKey);
//         if (!aPlan || aPlan.length === 0) {
//             await this._forceLoadPlan(oContext);
//             aPlan = oLocalModel.getProperty("/planesDetalle/" + sKey) || [];
//         }

//         // --- REGLA: MES VENCIDO SIN ORDEN ---
//         const sTipoFact = oData.TipoFacturacion.includes("|") ? oData.TipoFacturacion.split("|")[1].trim() : oData.TipoFacturacion;
//         if (sTipoFact.toUpperCase().includes("VENCIDO")) {
//             const bTieneOrden = aPlan.some((oLine: any) => 
//                 (oLine.Vbeln && oLine.Vbeln.trim() !== "" && oLine.Vbeln !== "---") || 
//                 (oLine.Factura && oLine.Factura.trim() !== "")
//             );

//             if (!bTieneOrden) {
//                 aRejectedByRule.push(`- Contrato: ${oData.Contrato}, Pos: ${this.formatPos(oData.PosContrato)} (Sin Orden de Servicio)`);
//                 oTable.setSelectedItem(oItem, false);
//                 continue;
//             }
//         }

//         // --- VALIDACIÓN DE FACTURACIÓN PREVIA ---
//         const oPlanMesAnio = aPlan.find((oLine: any) => {
//             if (!oLine.Afdat) return false;
//             return oLine.Afdat.substring(0, 4) === sYear && oLine.Afdat.substring(4, 6) === sMonth;
//         });

//         const bTieneFactura = oPlanMesAnio && oPlanMesAnio.Factura;

//         if (bTieneFactura) {
//             aAlreadyBilled.push(`- Contrato: ${oData.Contrato}, Pos: ${this.formatPos(oData.PosContrato)}`);
//         } else {
//             aDataToProcess.push(oData);
//         }
//     }

//     this.getView()?.setBusy(false);

//     // Mensaje de advertencia si hubo rechazos por regla de negocio
//     if (aRejectedByRule.length > 0) {
//         await new Promise((resolve) => {
//             MessageBox.error("Las siguientes posiciones se omitieron por ser 'Mes Vencido' sin Orden de Servicio:\n\n" + aRejectedByRule.join("\n"), {
//                 onClose: resolve
//             });
//         });
//     }

//     if (aDataToProcess.length === 0) {
//         if (aAlreadyBilled.length > 0) {
//             MessageBox.error(`Todas las posiciones seleccionadas ya aparecen como facturadas para ${sMonth}/${sYear}.`);
//         }
//         return;
//     }

//     // 2. AGRUPACIÓN POR CLIENTE CON DETALLE DE CONTRATOS
//     const mGroups = aDataToProcess.reduce((acc: any, item: any) => {
//         const sKey = item.Cliente;
//         if (!acc[sKey]) {
//             acc[sKey] = {
//                 Cliente: sKey,
//                 NombreCliente: item.NombreCliente,
//                 ContratosSet: new Set(),
//                 Posiciones: 0,
//                 Items: []
//             };
//         }
//         acc[sKey].ContratosSet.add(item.Contrato);
//         acc[sKey].Posiciones++;
//         acc[sKey].Items.push(item);
//         return acc;
//     }, {});

//     const aSummary = Object.values(mGroups).map((oGroup: any) => ({
//         Cliente: oGroup.Cliente,
//         NombreCliente: oGroup.NombreCliente,
//         CantContratos: oGroup.ContratosSet.size,
//         CantPosiciones: oGroup.Posiciones,
//         DetalleContratos: Array.from(oGroup.ContratosSet).join(", "),
//         Items: oGroup.Items
//     }));

//     // 3. CONFIGURACIÓN DINÁMICA PARA EL FRAGMENTO
//     const bMultiCliente = aSummary.length > 1;
//     const sHeaderText = bMultiCliente 
//         ? "Se han seleccionado partidas de múltiples clientes. Revise el resumen:" 
//         : `Resumen de facturación para el cliente ${aSummary[0].NombreCliente}:`;

//     const sMesTxt = oMonthSelect.getSelectedItem()?.getText() || "";

//     oLocalModel.setProperty("/resumenFacturacion", aSummary);
//     oLocalModel.setProperty("/confirmHeaderText", sHeaderText);
//     oLocalModel.setProperty("/mesFacturarLabel", `${sMesTxt} ${sYear}`);
//     oLocalModel.setProperty("/isMultiCliente", bMultiCliente);
//     oLocalModel.setProperty("/totalPartidasAFacturar", aDataToProcess.length);
//     oLocalModel.setProperty("/msgExclusiones", aAlreadyBilled.length > 0 ? aAlreadyBilled.join("\n") : "");

//     // 4. LLAMADA A LA VENTANA NUEVA (Fragment)
//     this._openConfirmBillingDialog(aDataToProcess);
// }

public async onProcessBilling(): Promise<void> {
    const oTable = this.byId("tableContracts") as Table;
    const aSelectedItems = oTable.getSelectedItems();
    
    if (!aSelectedItems || aSelectedItems.length === 0) {
        MessageToast.show("Por favor, seleccione al menos una partida.");
        return; 
    }

    const oMonthSelect = this.byId("slMonthFilter") as Select;
    const oYearSelect = this.byId("slYearFilter") as Select;
    const sMonth = oMonthSelect.getSelectedKey();
    const sYear = oYearSelect.getSelectedKey();

    if (sMonth === "all" || sYear === "all") {
        MessageBox.warning("Para procesar la factura, debe seleccionar un MES y un AÑO específicos.");
        return;
    }

    this.getView()?.setBusy(true);

    const oLocalModel = this.getView()?.getModel("local") as JSONModel;
    const aDataToProcess: any[] = [];
    const aAlreadyBilled: string[] = [];
    const aRejectedByRule: string[] = [];

    // 1. Filtrado de posiciones (Reglas de Negocio + Facturación previa)
    for (const oItem of aSelectedItems) {
        const oContext = oItem.getBindingContext("ZSD_GET_CONTRACT_BILLING_SRV");
        
        if (!oContext) {
            continue; 
        }

        const oData = oContext.getObject() as any;
        const sKey = oData.Contrato + "_" + oData.PosContrato;
        
        // --- ASEGURAR CARGA DEL PLAN ---
        let aPlan = oLocalModel.getProperty("/planesDetalle/" + sKey);
        if (!aPlan || aPlan.length === 0) {
            await this._forceLoadPlan(oContext);
            aPlan = oLocalModel.getProperty("/planesDetalle/" + sKey) || [];
        }

        // Localizar la línea específica del mes/año a facturar
        const oPlanMes = aPlan.find((oLine: any) => 
            oLine.Afdat && oLine.Afdat.substring(0, 4) === sYear && oLine.Afdat.substring(4, 6) === sMonth
        );

        if (!oPlanMes) {
            aRejectedByRule.push(`- Contrato: ${oData.Contrato}, Pos: ${this.formatPos(oData.PosContrato)} (No hay plan para ${sMonth}/${sYear})`);
            oTable.setSelectedItem(oItem, false);
            continue;
        }

        // --- REGLA: MES VENCIDO SIN ORDEN ---
        const sTipoFact = oData.TipoFacturacion.includes("|") ? oData.TipoFacturacion.split("|")[1].trim() : oData.TipoFacturacion;
        if (sTipoFact.toUpperCase().includes("VENCIDO")) {
            // Validar que la orden esté presente y sea válida
            const bTieneOrden = oPlanMes.Orden && 
                                oPlanMes.Orden.trim() !== "" && 
                                oPlanMes.Orden !== "---" && 
                                oPlanMes.Orden !== "000000000000";

            if (!bTieneOrden) {
                aRejectedByRule.push(`- Contrato: ${oData.Contrato}, Pos: ${this.formatPos(oData.PosContrato)} (Sin Orden de Servicio válida)`);
                oTable.setSelectedItem(oItem, false);
                continue;
            }
        }

        // --- VALIDACIÓN DE FACTURACIÓN PREVIA ---
        const bTieneFactura = oPlanMes.Factura && oPlanMes.Factura.trim() !== "" && oPlanMes.Factura !== "---";

        if (bTieneFactura) {
            aAlreadyBilled.push(`- Contrato: ${oData.Contrato}, Pos: ${this.formatPos(oData.PosContrato)}`);
        } else {
            aDataToProcess.push(oData);
        }
    }

    this.getView()?.setBusy(false);

    // Mensaje de advertencia si hubo rechazos por regla de negocio
    if (aRejectedByRule.length > 0) {
        await new Promise((resolve) => {
            MessageBox.error("Las siguientes posiciones se omitieron por no cumplir con la Orden de Servicio requerida:\n\n" + aRejectedByRule.join("\n"), {
                onClose: resolve
            });
        });
    }

    if (aDataToProcess.length === 0) {
        if (aAlreadyBilled.length > 0) {
            MessageBox.error(`Todas las posiciones seleccionadas ya aparecen como facturadas para ${sMonth}/${sYear}.`);
        }
        return;
    }

    // 2. AGRUPACIÓN POR CLIENTE CON DETALLE DE CONTRATOS
    const mGroups = aDataToProcess.reduce((acc: any, item: any) => {
        const sKey = item.Cliente;
        if (!acc[sKey]) {
            acc[sKey] = {
                Cliente: sKey,
                NombreCliente: item.NombreCliente,
                ContratosSet: new Set(),
                Posiciones: 0,
                Items: []
            };
        }
        acc[sKey].ContratosSet.add(item.Contrato);
        acc[sKey].Posiciones++;
        acc[sKey].Items.push(item);
        return acc;
    }, {});

    const aSummary = Object.values(mGroups).map((oGroup: any) => ({
        Cliente: oGroup.Cliente,
        NombreCliente: oGroup.NombreCliente,
        CantContratos: oGroup.ContratosSet.size,
        CantPosiciones: oGroup.Posiciones,
        DetalleContratos: Array.from(oGroup.ContratosSet).join(", "),
        Items: oGroup.Items
    }));

    // 3. CONFIGURACIÓN DINÁMICA PARA EL FRAGMENTO
    const bMultiCliente = aSummary.length > 1;
    const sHeaderText = bMultiCliente 
        ? "Se han seleccionado partidas de múltiples clientes. Revise el resumen:" 
        : `Resumen de facturación para el cliente ${aSummary[0].NombreCliente}:`;

    const sMesTxt = oMonthSelect.getSelectedItem()?.getText() || "";

    oLocalModel.setProperty("/resumenFacturacion", aSummary);
    oLocalModel.setProperty("/confirmHeaderText", sHeaderText);
    oLocalModel.setProperty("/mesFacturarLabel", `${sMesTxt} ${sYear}`);
    oLocalModel.setProperty("/isMultiCliente", bMultiCliente);
    oLocalModel.setProperty("/totalPartidasAFacturar", aDataToProcess.length);
    oLocalModel.setProperty("/msgExclusiones", aAlreadyBilled.length > 0 ? aAlreadyBilled.join("\n") : "");

    // 4. LLAMADA A LA VENTANA NUEVA (Fragment)
    this._openConfirmBillingDialog(aDataToProcess);
}


/**
 * Función interna para gestionar la ventana nueva de confirmación multicliente
 */
private async _openConfirmBillingDialog(aDataToProcess: any[]): Promise<void> {
    const oView = this.getView();
    if (!oView) return;

    this._aItemsToProcess = aDataToProcess;

    if (!this._oConfirmDialog) {
        // Uso directo del módulo importado
        this._oConfirmDialog = await Fragment.load({
            id: oView.getId(),
            name: "contractbilling.view.fragment.ConfirmBilling",
            controller: this
        });
        oView.addDependent(this._oConfirmDialog);
    }

    this._oConfirmDialog.open();
}

    /**
     * Envío al Backend (Ajustado para insertar G| o I| en Observaciones)
     */
    /**
     * Envío al Backend (Ajustado para usar el mes del filtro en la fecha de factura)
     */
private _sendToBackend(aData: any[], sModePrefix: string): void {
    const oView = this.getView();
    const oModel = oView?.getModel("ZSD_GET_CONTRACT_BILLING_SRV") as ODataModel;
    const oLocalModel = oView?.getModel("local") as JSONModel;
    
    if (!oView || !oModel || !oLocalModel) return;

    oView.setBusy(true);

    const sMonth = (this.byId("slMonthFilter") as Select).getSelectedKey();
    const iYear = (this.byId("slYearFilter") as Select).getSelectedKey();
    const oNow = new Date();
    const sFechaHeader = `${iYear}${sMonth}${String(oNow.getDate()).padStart(2, '0')}`;
    
    const oPayload = {
        "ProcessId": "BATCH_" + sFechaHeader + "_" + oNow.getTime().toString().slice(-3),
        "FechaFactura": sFechaHeader,
        "Observaciones": sModePrefix + "|",
        "BillingItemsSet": aData.map(oItem => {
            const sKey = oItem.Contrato + "_" + oItem.PosContrato;
            const aPlanItems = oLocalModel.getProperty("/planesDetalle/" + sKey) || [];
            const sFplnr = aPlanItems.length > 0 ? aPlanItems[0].Fplnr : "";
            return {
                "Contrato": oItem.Contrato,
                "PosContrato": oItem.PosContrato,
                "Total": sFplnr, 
                "TipoFact": oItem.TipoFact || "A"
            };
        })
    };


    console.group("🚀 Payload enviado al Backend SAP");
    console.log(JSON.stringify(oPayload, null, 4));
    console.groupEnd();

    
    oModel.create("/BillingHeaderSet", oPayload, {
        success: (oResponse: any) => {
            oView.setBusy(false);
            const aItemsRes = oResponse.BillingItemsSet?.results || [];
            
            // --- NUEVA LÓGICA DE PROCESAMIENTO DE RESPUESTA ---
            // Agrupamos por cliente basándonos en el string pipeado: "Contrato | Cliente | Pos | Factura"
            const mGroups: any = {};

            aItemsRes.forEach((oItem: any) => {
                if (!oItem.Contrato) return;
                
                const aParts = oItem.Contrato.split("|").map((s: string) => s.trim());
                if (aParts.length < 4) return;

                const [sContrato, sCliente, sPos, sFactura] = aParts;

                if (!mGroups[sCliente]) {
                    mGroups[sCliente] = [];
                }
                mGroups[sCliente].push(`   • Contrato: ${sContrato} | Pos: ${sPos} | Factura: ${sFactura}`);
            });

            // Construcción del mensaje final
            let sMsg = oResponse.Observaciones ? oResponse.Observaciones : "Facturación procesada correctamente.";
            sMsg += "\n\nDetalle por Cliente:\n";

            const aClientes = Object.keys(mGroups);
            if (aClientes.length > 0) {
                aClientes.forEach(sNomCliente => {
                    sMsg += `\n👤 ${sNomCliente}:\n${mGroups[sNomCliente].join("\n")}\n`;
                });
            } else {
                sMsg += "\nNo se generaron folios nuevos.";
            }

            MessageBox.success(sMsg, {
                title: "Resultado de Facturación",
                contentWidth: "500px", // Ancho ajustado para que los pipes se vean bien
                onClose: () => {
                    this.onDeselectAll();
                    oLocalModel.setProperty("/planesDetalle", {}); 
                    this.onCollapseAll();
                    oModel.refresh(true, true);
                    MessageToast.show("Datos actualizados correctamente.");
                }
            });
        },
        error: (oError: any) => {
            oView.setBusy(false);
            let sErrorDetail = "Error en SAP";
            try {
                const oMsg = JSON.parse(oError.responseText);
                sErrorDetail = oMsg.error.message.value;
            } catch (e) { 
                console.error(oError); 
            }
            MessageBox.error(sErrorDetail);
        }
    });
}



    
public onSelectionChange(): void {
    const oTable = this.byId("tableContracts") as Table;
    const oBtn = this.byId("btnProcess") as Button;
    const oTxtInfo = this.byId("txtSelectionInfo") as Text;
    const oTxtTotal = this.byId("txtTotalSelected") as Title;
    const aSelectedItems = oTable.getSelectedItems();
    
    if (aSelectedItems && aSelectedItems.length > 0) {
        const fTotal = aSelectedItems.reduce((acc, oItem) => {
            const oContext = oItem.getBindingContext("ZSD_GET_CONTRACT_BILLING_SRV");
            const oData = oContext ? (oContext.getObject() as any) : { Total: 0 };
            return acc + parseFloat(oData.Total || 0);
        }, 0);

        const sFormattedTotal = new Intl.NumberFormat('es-MX', {
            style: 'currency', currency: 'MXN'
        }).format(fTotal);

        oTxtInfo.setText(`${aSelectedItems.length} seleccionadas:`);
        oTxtTotal.setText(sFormattedTotal);
        oTxtTotal.setVisible(true);
        oBtn.setEnabled(true);
    } else {
        oTxtInfo.setText("Sin partidas seleccionadas");
        oTxtTotal.setVisible(false);
        oBtn.setEnabled(false);
    }
}



    private async _validateRowSelection(oItem: any): Promise<boolean> {
    const oContext = oItem.getBindingContext("ZSD_GET_CONTRACT_BILLING_SRV");
    const oData = oContext.getObject();
    const oLocalModel = this.getView()?.getModel("local") as JSONModel;
    
    const sTipoFact = oData.TipoFacturacion.includes("|") ? 
                      oData.TipoFacturacion.split("|")[1].trim() : 
                      oData.TipoFacturacion;

    // Regla: Adelantada siempre pasa
    if (sTipoFact.toUpperCase().includes("ADELANTADA")) {
        return true;
    }

    // Regla: Mes Vencido requiere validación
    if (sTipoFact.toUpperCase().includes("VENCIDO")) {
        const sKey = oData.Contrato + "_" + oData.PosContrato;
        let aPlan = oLocalModel.getProperty("/planesDetalle/" + sKey);

        // Si el plan no está en el modelo local, lo cargamos asíncronamente
        if (!aPlan || aPlan.length === 0) {
            try {
                // Llamamos a tu función de carga existente
                await this._forceLoadPlan(oContext);
                aPlan = oLocalModel.getProperty("/planesDetalle/" + sKey);
            } catch (e) {
                return false;
            }
        }

        // Verificamos si existe orden/factura en el plan
        const bTieneOrden = aPlan && aPlan.some((oLine: any) => 
            (oLine.Vbeln && oLine.Vbeln.trim() !== "" && oLine.Vbeln !== "---") || 
            (oLine.Factura && oLine.Factura.trim() !== "")
        );

        if (!bTieneOrden) {
            // Solo mostramos MessageBox en selección individual para no saturar en el "Seleccionar Todo"
            return false;
        }
    }

    return true;
}


private _forceLoadPlan(oContext: any): Promise<void> {
    return new Promise((resolve) => {
        const sKey = oContext.getObject().Contrato + "_" + oContext.getObject().PosContrato;
        
        // Disparamos tu lógica de carga existente
        this._fetchBillingPlan(oContext, { setBusy: () => {} });

        const interval = setInterval(() => {
            if (this.getView()?.getModel("local")?.getProperty("/planesDetalle/" + sKey + "_Loaded")) {
                clearInterval(interval);
                resolve();
            }
        }, 150);
    });
}


    public onApplyMonthFilter(): void {
    const oView = this.getView();
    if (!oView) return;

    // Disparamos manualmente la lógica de filtrado que ya tienes en _onObjectMatched
    // pasando un objeto simulado para reutilizar la lógica de lectura de URL y Modelos.
    this._onObjectMatched({
        getParameter: (s: string) => {
            // Aquí debes asegurarte de tener guardados los argumentos de la ruta
            // Si no los guardaste, puedes obtenerlos del Router o del modelo de UI.
            return ""; 
        },
        getParameters: () => { return {}; }
    } as any);
}


/**
 * Se dispara al cambiar el mes en el Select. Filtra las tablas internas visibles.
 */

/*
public onMonthFilterChange(): void {
    const sSelectedMonth = (this.byId("slMonthFilter") as Select).getSelectedKey();
    const oTable = this.byId("tableContracts") as Table;
    const aItems = oTable.getItems();

    aItems.forEach((oItem: any) => {
        // Obtenemos la última celda donde reside el detalle del plan
        const aCells = oItem.getCells ? oItem.getCells() : [];
        if (aCells.length > 0) {
            const oVBoxContenedor = aCells[aCells.length - 1] as VBox;
            const oVBoxDetalle = oVBoxContenedor.getItems()[1] as VBox;
            const oScroll = oVBoxDetalle.getItems()[1] as ScrollContainer;
            // Accedemos a la tabla interna (id: innerBillingTable)
            const oTableInner = oScroll.getContent()[0] as Table;

            if (oTableInner && oTableInner.getBinding("items")) {
                this._applyPlanLocalFilter(oTableInner.getBinding("items"), sSelectedMonth);
            }
        }
    });
}
*/
public onMonthFilterChange(): void {
    // Obtenemos el mes y el año de los Selects
    const sMonth = (this.byId("slMonthFilter") as Select).getSelectedKey();
    const sYear = (this.byId("slYearFilter") as Select).getSelectedKey();

    const oTable = this.byId("tableContracts") as Table;
    const aItems = oTable.getItems();

    aItems.forEach((oItem: any) => {
        if (!(oItem instanceof ColumnListItem)) return;
        
        const aCells = oItem.getCells();
        const oVBoxContenedor = aCells[aCells.length - 1] as VBox;
        const oVBoxDetalle = oVBoxContenedor.getItems()[1] as VBox;
        
        if (oVBoxDetalle.getVisible()) {
            const oScroll = oVBoxDetalle.getItems()[1] as ScrollContainer;
            const oTableInner = oScroll.getContent()[0] as Table;
            const oBinding = oTableInner.getBinding("items");

            if (oBinding) {
                // Pasamos sMonth y ahora la función usará internamente el sYear del Select
                this._applyPlanLocalFilter(oBinding, sMonth);
            }
        }
    });
}



/**
 * Aplica el filtro de mes al binding de la tabla interna
 *//*
private _applyPlanLocalFilter(oBinding: any, sMonth: string): void {
    const aFilters = [];
    if (sMonth !== "all") {
        // Creamos un filtro personalizado para extraer el mes de la cadena YYYYMMDD
        aFilters.push(new Filter({
            path: "Afdat",
            test: (sValue: string) => {
                if (!sValue) return false;
                // En YYYYMMDD, el mes son los caracteres en posición 4 y 5
                const sMonthPart = sValue.substring(4, 6);
                return sMonthPart === sMonth;
            }
        }));
    }
    oBinding.filter(aFilters);
}*/
    

private _applyPlanLocalFilter(oBinding: any, sMonth: string): void {
    const sYear = (this.byId("slYearFilter") as Select).getSelectedKey();
    const aFilters = [];

    // Solo aplicamos filtros si alguno de los dos NO es "all"
    if (sMonth !== "all" || sYear !== "all") {
        aFilters.push(new Filter({
            path: "Afdat",
            test: (sValue: string): boolean => {
                if (!sValue) return false;

                const sValueMonth = sValue.substring(4, 6);
                const sValueYear = sValue.substring(0, 4);

                const bMonthMatch = (sMonth === "all" || sValueMonth === sMonth);
                const bYearMatch = (sYear === "all" || sValueYear === sYear);

                return bMonthMatch && bYearMatch;
            }
        }));
    }
    
    // Si ambos son "all", aFilters estará vacío y mostrará todo
    oBinding.filter(aFilters);
}

/**
 * Expande automáticamente todos los planes de facturación de la tabla
 */
public onExpandAll(): void {
    const oView = this.getView();
    const oTable = this.byId("tableContracts") as Table;
    const aItems = oTable.getItems();
    
    // Filtramos solo filas de datos
    const aDataItems = aItems.filter(oItem => oItem instanceof ColumnListItem) as ColumnListItem[];
    this._iPendingRequests = 0;

    if (aDataItems.length === 0) {
        return;
    }

    // 1. Crear o recuperar el BusyDialog
    if (!this._oBusyDialog) {
        this._oBusyDialog = new BusyDialog({
            title: "Cargando Planes de Facturación",
            text: "Iniciando descarga de datos..."
        });
    }

    this._oBusyDialog.open();

    aDataItems.forEach((oItem) => {
        const oContext = oItem.getBindingContext("ZSD_GET_CONTRACT_BILLING_SRV");
        const oData = oContext ? oContext.getObject() : null;
        
        const aCells = oItem.getCells();
        const oVBoxContenedor = aCells[aCells.length - 1] as VBox;
        const oBtnToggle = oVBoxContenedor.getItems()[0] as Button;
        const oVBoxDetalle = oVBoxContenedor.getItems()[1] as VBox;

        if (oVBoxDetalle && !oVBoxDetalle.getVisible()) {
            this._iPendingRequests++;
            
            // Actualizar mensaje con el contrato actual
            if (oData) {
                this._oBusyDialog.setText(
                    `Procesando Contratos, favor de esperar.`
                );
            }

            this.onTogglePlanDetail({
                getSource: () => oBtnToggle
            });
        }
    });

    if (this._iPendingRequests === 0) {
        this._oBusyDialog.close();
    }
}

private _finalizeRequest(oContainer: any): void {
    // Validación de seguridad para el contenedor
    if (oContainer && typeof oContainer.setBusy === "function") {
        oContainer.setBusy(false);
    }

    this._iPendingRequests--;
    
    // Si por algún error de red o navegación el contador baja de cero, lo reseteamos
    if (this._iPendingRequests < 0) {
        this._iPendingRequests = 0;
    }

    // Actualizamos el contador visual si hay peticiones pendientes
    if (this._oBusyDialog && this._iPendingRequests > 0) {
        this._oBusyDialog.setTitle(`Quedan ${this._iPendingRequests} planes por cargar...`);
        this._oBusyDialog.setText(`Procesando Contratos, favor de esperar.`);
    }

    // Si ya no hay peticiones pendientes (o el contador se reseteó), cerramos todo
    if (this._iPendingRequests === 0) {
        if (this._oBusyDialog) {
            this._oBusyDialog.close();
        }
        this.getView()?.setBusy(false);
    }
}


/**
 * Calcula el porcentaje de avance basado exclusivamente en los ítems del plan local
 */
public formatProgressFromPlan(sContrato: string, sPos: string, oPlanesDetalle: any): number {
    // Si aún no hay datos en el modelo local para esta clave, el progreso es 0
    if (!oPlanesDetalle || !sContrato || !sPos) {
        return 0;
    }

    const sKey = `${sContrato}_${sPos}`;
    const aItems = oPlanesDetalle[sKey];

    // Si el array no existe o está vacío, no hay plan cargado aún
    if (!aItems || !Array.isArray(aItems) || aItems.length === 0) {
        return 0;
    }

  const iTotalMeses = aItems.length;
  // Consideramos facturado si tiene un número de factura válido (no vacío, no nulo, no guiones)
  const iFacturados = aItems.filter((oItem: any) => 
      oItem.Factura && oItem.Factura.trim() !== "" && oItem.Factura !== "---"
  ).length;

  return Math.round((iFacturados / iTotalMeses) * 100);
}

/**
 * Genera el texto descriptivo basado en el conteo del plan (ej: "3 / 12 meses")
 */
public formatProgressText(sContrato: string, sPos: string, oPlanesDetalle: any): string {
    if (!oPlanesDetalle || !sContrato || !sPos) {
        return "Pendiente de carga...";
    }

    const sKey = `${sContrato}_${sPos}`;
    const aItems = oPlanesDetalle[sKey];

    if (!aItems || !Array.isArray(aItems) || aItems.length === 0) {
        return "Cargando plan...";
    }

    const iTotalMeses = aItems.length;
    const iFacturados = aItems.filter((oItem: any) => 
        oItem.Factura && oItem.Factura.trim() !== "" && oItem.Factura !== "---"
    ).length;

    return `${iFacturados} / ${iTotalMeses} meses`;
}

public formatProgressState(sContrato: string, sPos: string, oPlanesDetalle: any): string {
    const iPercent = this.formatProgressFromPlan(sContrato, sPos, oPlanesDetalle);
    
    if (iPercent === 0) return "None";
    if (iPercent === 100) return "Success";
    if (iPercent > 50) return "Information";
    return "Warning";
}

public onConfirmGlobalBilling(): void {
    this._oConfirmDialog.close();
    // Enviamos el prefijo 'G' para Factura Global
    this._sendToBackend(this._aItemsToProcess, "G");
}

public onConfirmIndividualBilling(): void {
    this._oConfirmDialog.close();
    // Enviamos el prefijo 'I' para Factura Individual por Contrato
    this._sendToBackend(this._aItemsToProcess, "I");
}

public onCloseConfirmDialog(): void {
    this._oConfirmDialog.close();
}


}