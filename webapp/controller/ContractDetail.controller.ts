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

/**
 * @namespace contractbilling.controller
 */
export default class ContractDetail extends Controller {

    private _iPendingRequests: number = 0;
    private _oBusyDialog: BusyDialog;

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

        const oArgs = oEvent.getParameter("arguments");
        const sCustomer = oArgs.customerId;
        const sDate = oArgs.date;
        const aFilters: Filter[] = [];

        // 1. OBTENER DATOS DEL MODELO GLOBAL
        const oComponent = this.getOwnerComponent();
        const oModelPeticion = this.getOwnerComponent()?.getModel("mBillingContract") as JSONModel;

        // Si el modelo está vacío (por un refresh), intentamos recuperar de la sesión
        if (oModelPeticion && (!oModelPeticion.getProperty("/oQuery/selectedCustomers") || 
            oModelPeticion.getProperty("/oQuery/selectedCustomers").length === 0)) {
            
            const sSavedData = sessionStorage.getItem("lastBillingQuery");
            if (sSavedData) {
                oModelPeticion.setData(JSON.parse(sSavedData));
            }
        }

        const aSelectedCustomers = oModelPeticion?.getProperty("/oQuery/selectedCustomers") || [];
        const aSelectedQuotations = oModelPeticion?.getProperty("/oQuery/selectedQuotations") || [];
        const aSelectedStatus = oModelPeticion?.getProperty("/oQuery/selectedStatus") || [];
       
   

        // 2. FILTRADO DE CLIENTES
        if (sCustomer === "multi" && aSelectedCustomers.length > 0) {
            const aCustomerFilters = aSelectedCustomers.map((sId: string) => 
                new Filter("Cliente", FilterOperator.EQ, sId)
            );
            aFilters.push(new Filter({ filters: aCustomerFilters, and: false }));
        } else if (sCustomer && sCustomer !== "multi" && sCustomer !== "all") {
            aFilters.push(new Filter("Cliente", FilterOperator.EQ, sCustomer));
        }

        // 3. FILTRADO DE COTIZACIONES
        if (aSelectedQuotations.length > 0) {
            const aQuotationFilters = aSelectedQuotations.map((sId: string) => 
                new Filter("Contrato", FilterOperator.EQ, sId) 
            );
            aFilters.push(new Filter({ filters: aQuotationFilters, and: false }));
        }

        // 4. FILTRADO POR ESTATUS
        if (aSelectedStatus.length > 0) {
            const aStatusFilters = aSelectedStatus.map((sKey: string) => 
                new Filter("Status", FilterOperator.EQ, sKey)
            );
            aFilters.push(new Filter({ filters: aStatusFilters, and: false }));
        }

        // 5. FILTRADO POR FECHA
        if (sDate && sDate !== "all") {
            if (sDate.includes("_")) {
                const aDates = sDate.split("_");
                const oStart = new Date(aDates[0] + "T00:00:00");
                const oEnd = new Date(aDates[1] + "T23:59:59");
                aFilters.push(new Filter("VIGENCIAINI", FilterOperator.BT, oStart, oEnd));
            } else {
                const oDate = new Date(sDate + "T00:00:00");
                aFilters.push(new Filter("VIGENCIAINI", FilterOperator.EQ, oDate));
            }
        }

        // --- EJECUCIÓN OPTIMIZADA ---
        const oTable = this.byId("tableContracts") as Table;
        const oBinding = oTable?.getBinding("items") as ODataListBinding;

        if (oBinding) {
            oView.setBusy(true); // Bloqueamos la pantalla
            
            oBinding.attachEventOnce("dataReceived", () => {
                // Una vez recibidos los contratos, ejecutamos la expansión masiva
                // No quitamos el busy aquí, lo hará onExpandAll al terminar
                this._updateTableStatistics();
                setTimeout(() => {
                    this.onExpandAll(); 
                }, 200);
            });

            oBinding.filter(aFilters, FilterType.Application);
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
            // Importante: Usar un ID único por petición para evitar el error 500 de Changesets
            groupId: "changeset_" + sKey, 
            success: (oData: any) => {
                this._finalizeRequest(oContainer); // Gestión de contador
                const aPlanItems = oData.BillingPlanItemsSet?.results || [];

                if (aPlanItems.length > 0) {
                    oLocalModel.setProperty("/planesDetalle/" + sKey, aPlanItems);
                    oLocalModel.setProperty("/planesDetalle/" + sKey + "_Loaded", true);

                    const oScroll = oContainer.getItems()[1];
                    const oTableDetalle = oScroll.getContent()[0] as Table; 

                    if (oTableDetalle && typeof oTableDetalle.bindItems === "function") {
                        oTableDetalle.bindItems({
                            path: "local>/planesDetalle/" + sKey,
                            template: new ColumnListItem({
                                cells: [
                                    new Label({ design: "Bold", text: { path: "local>Afdat", type: new (DateType as any)({ source: { pattern: "yyyyMMdd" } }, { pattern: "MMM yyyy" }) } }),
                                    new Text({ text: "{= ${local>Vbeln} ? ${local>Vbeln} : '---' }" }),
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
                        oTableDetalle.setFixedLayout(false);
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

   public onProcessBilling(): void {
    const oTable = this.byId("tableContracts") as Table;
    const aSelectedItems = oTable.getSelectedItems();
    
    if (!aSelectedItems || aSelectedItems.length === 0) {
        MessageToast.show("Por favor, seleccione al menos una partida.");
        return; 
    }

    const sMonth = (this.byId("slMonthFilter") as Select).getSelectedKey();
    const sYear = (this.byId("slYearFilter") as Select).getSelectedKey();

    if (sMonth === "all" || sYear === "all") {
        MessageBox.warning("Para procesar la factura, debe seleccionar un MES y un AÑO específicos.");
        return;
    }

    const oLocalModel = this.getView()?.getModel("local") as JSONModel;
    const aDataToProcess: any[] = [];
    const aAlreadyBilled: string[] = [];

    aSelectedItems.forEach((oItem: any) => {
        const oContext = oItem.getBindingContext("ZSD_GET_CONTRACT_BILLING_SRV");
        const oData = oContext.getObject();
        const sKey = oData.Contrato + "_" + oData.PosContrato;
        
        // Obtenemos el plan del modelo local
        const aPlan = oLocalModel.getProperty("/planesDetalle/" + sKey) || [];

        // Buscamos la línea exacta
        const oPlanMesAnio = aPlan.find((oLine: any) => {
            if (!oLine.Afdat) return false;
            return oLine.Afdat.substring(0, 4) === sYear && oLine.Afdat.substring(4, 6) === sMonth;
        });

        // LOGICA DE DECISIÓN REFORZADA:
        // Solo excluimos si encontramos el registro Y tiene un folio de factura real.
        const bTieneFactura = oPlanMesAnio && 
                             oPlanMesAnio.Factura 

        if (bTieneFactura) {
            aAlreadyBilled.push(`- Contrato: ${oData.Contrato}, Pos: ${this.formatPos(oData.PosContrato)}`);
        } else {
            aDataToProcess.push(oData);
        }
    });

    // Validamos si quedó algo para procesar
    if (aDataToProcess.length === 0) {
        MessageBox.error(`Todas las posiciones seleccionadas ya aparecen como facturadas para ${sMonth}/${sYear} en el detalle.`);
        return;
    }

    // --- VALIDACIÓN DE CLIENTE ÚNICO ---
    const aUniqueCustomerNames = [...new Set(aDataToProcess.map(oItem => oItem.NombreCliente || oItem.Cliente))];
    if (aUniqueCustomerNames.length > 1) {
        MessageBox.error("No se pueden mezclar clientes. Seleccione solo posiciones de: " + aUniqueCustomerNames[0]);
        return;
    }

    const aUniqueContracts = [...new Set(aDataToProcess.map(oItem => oItem.Contrato))];
    const sFirstCustomerName = aUniqueCustomerNames[0];

    // Mensaje de advertencia de exclusiones
    let sExclusionMsg = "";
    if (aAlreadyBilled.length > 0) {
        sExclusionMsg = `\n\n⚠️ *Omitidas (ya facturadas en ${sMonth}/${sYear}):*\n${aAlreadyBilled.join("\n")}`;
    }

    // Mostrar confirmación final
    if (aUniqueContracts.length > 1) {
        const sMsgMulti = `Se facturarán ${aDataToProcess.length} posiciones (${aUniqueContracts.length} contratos) para ${sFirstCustomerName}.${sExclusionMsg}\n\n¿Desea Factura Global o Individual por Contrato?`;

        MessageBox.show(sMsgMulti, {
            icon: MessageBox.Icon.QUESTION,
            title: "Confirmar Proceso Masivo",
            actions: ["Factura Global", "Por Contrato", MessageBox.Action.CANCEL],
            emphasizedAction: "Factura Global",
            onClose: (sAction: string | null) => {
                if (sAction === "Factura Global") this._sendToBackend(aDataToProcess, "G");
                else if (sAction === "Por Contrato") this._sendToBackend(aDataToProcess, "I");
            }
        });
    } else {
        const sDetalle = aDataToProcess.map(oItem => `- Posición: ${this.formatPos(oItem.PosContrato)}`).join("\n");
        const sMsgSimple = `¿Confirmar facturación de ${aDataToProcess.length} posiciones del contrato ${aUniqueContracts[0]}?${sExclusionMsg}\n\n${sDetalle}`;
        
        MessageBox.confirm(sMsgSimple, {
            title: "Revisión de Partidas",
            onClose: (oAction: string | null) => {
                if (oAction === MessageBox.Action.OK) this._sendToBackend(aDataToProcess, "I");
            }
        });
    }
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

        oModel.create("/BillingHeaderSet", oPayload, {
            success: (oResponse: any) => {
                oView.setBusy(false);
                const aItemsRes = oResponse.BillingItemsSet?.results || [];
                const aFolios = [...new Set(aItemsRes.map((o: any) => o.Contrato).filter((f: any) => f))];
                
                let sMsg = oResponse.Observaciones ? oResponse.Observaciones : "Facturación procesada correctamente.";
                sMsg += "\n\n";
                if (aFolios.length > 0) {
                    sMsg += "Documentos generados:\n" + aFolios.join("\n");
                }

                MessageBox.success(sMsg, {
                    title: "Resultado de Facturación",
                    onClose: () => {
    this.onDeselectAll();
    
    const oLocalModel = this.getView()?.getModel("local") as JSONModel;

    // 1. Vaciamos por completo el objeto de planes
    // Esto es instantáneo y elimina cualquier error de "No Data"
    oLocalModel.setProperty("/planesDetalle", {}); 

    // 2. Colapsamos para que la UI se resetee visualmente
    this.onCollapseAll();

    // 3. Refrescamos el OData con un delay pequeño
    // El refresh(true) invalida el caché local del ODataModel
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
                } catch (e) { console.error(oError); }
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
    oContainer.setBusy(false);
    this._iPendingRequests--;
    
    // Actualizamos el contador visual si quieres (opcional)
    if (this._oBusyDialog && this._iPendingRequests > 0) {
        this._oBusyDialog.setTitle(`Quedan ${this._iPendingRequests} planes por cargar...`);
    }

    // Si ya no hay peticiones pendientes, cerramos el diálogo
    if (this._iPendingRequests <= 0) {
        if (this._oBusyDialog) {
            this._oBusyDialog.close();
        }
        this.getView()?.setBusy(false);
    }
}

}